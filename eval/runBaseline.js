/**
 * runBaseline.js — Phase 0 baseline runner.
 *
 * Runs the golden set through the CURRENT SERA pipeline (Cohere embed →
 * MongoDB Atlas vector search → Groq generation), mirroring routes/ask.js,
 * and records per-question: retrieved chunks, generated answer, retrieval
 * precision/recall, a naive key-fact coverage proxy, latency (per stage),
 * and token usage/cost.
 *
 * Output: eval/runs/{label}-{timestamp}.json  + a console scorecard.
 *
 * This is intentionally NOT an LLM-as-judge harness — that is Phase 1.
 * Phase 0 only needs a defensible, reproducible "before" snapshot.
 *
 * Usage:
 *   node eval/runBaseline.js               # full set
 *   node eval/runBaseline.js --limit 5     # first 5 questions (smoke)
 *   node eval/runBaseline.js --label pre-hybrid
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const connectToMongo = require('../utils/mongodb');
const { retrieveRelevantChunks, formatChunksAsContext } = require('../utils/retrieve');

// ── Frozen baseline config (mirrors routes/ask.js) ──────────────────────────
const GEN_MODEL = 'llama-3.3-70b-versatile';
const EMBED_MODEL = 'cohere embed-english-v3.0 (1024d)';
const TOP_K = 3;
// Eval runs at temperature 0 for reproducibility; production streams at default.
const TEMPERATURE = 0;

const SYSTEM_PROMPT = `You are SERA — a warm, non-judgmental sexual health guide. Answer like a knowledgeable friend: honest, concise, never preachy. Keep responses short and conversational — 2 to 4 sentences unless the question genuinely needs more detail. Use plain language, no unnecessary lists or headers. If someone seems distressed, acknowledge their feelings first. Topics: sexual health, relationships, contraception, STIs, anatomy, intimacy.`;

// Groq pricing per 1M tokens (USD) — estimate, update if it changes.
const PRICE_PER_M = { input: 0.59, output: 0.79 };

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const LIMIT = parseInt(argVal('--limit', '0'), 10) || 0;
const LABEL = argVal('--label', 'baseline');

// ── Load golden set + corpus ─────────────────────────────────────────────────
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
const textToId = new Map(corpus.map(c => [c.text.trim(), c.id]));

function chunkIdFromText(text) {
  return textToId.get((text || '').trim()) || null;
}

// ── Metric helpers ────────────────────────────────────────────────────────────
function retrievalMetrics(retrievedIds, expectedIds) {
  const exp = new Set(expectedIds);
  const hits = retrievedIds.filter(id => exp.has(id));
  const precision = retrievedIds.length ? hits.length / retrievedIds.length : 0;
  const recall = exp.size ? hits.length / exp.size : null; // null when nothing expected
  const f1 = precision + (recall || 0) > 0 && recall !== null
    ? (2 * precision * recall) / (precision + recall)
    : (recall === null ? null : 0);
  return { precision, recall, f1, hitIds: hits };
}

function factCoverage(answer, keyFacts) {
  if (!keyFacts || !keyFacts.length) return null;
  const a = (answer || '').toLowerCase();
  const found = keyFacts.filter(f => a.includes(String(f).toLowerCase()));
  return { covered: found.length, total: keyFacts.length, ratio: found.length / keyFacts.length, missing: keyFacts.filter(f => !a.includes(String(f).toLowerCase())) };
}

function mean(nums) {
  const vals = nums.filter(n => typeof n === 'number' && !Number.isNaN(n));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function round(n, d = 4) {
  return n === null || n === undefined ? n : Math.round(n * 10 ** d) / 10 ** d;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY is not set — cannot run generation baseline. Set it in .env.');
    process.exit(1);
  }
  const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });

  await connectToMongo(); // needed for vector search; fails open to [] if unavailable

  let questions = golden.questions;
  if (LIMIT) questions = questions.slice(0, LIMIT);

  console.log(`\n▶ Running baseline "${LABEL}" over ${questions.length} question(s)`);
  console.log(`  gen=${GEN_MODEL} embed=${EMBED_MODEL} topK=${TOP_K} temp=${TEMPERATURE}\n`);

  const results = [];
  let anyRetrieval = false;

  for (const q of questions) {
    const row = { id: q.id, question: q.question, type: q.type, topic: q.topic, expected_source_ids: q.expected_source_ids };
    try {
      // 1. Retrieve (embed + vector search happen inside retrieveRelevantChunks)
      const tRet0 = Date.now();
      const chunks = await retrieveRelevantChunks(q.question, TOP_K);
      row.retrieval_ms = Date.now() - tRet0;
      if (chunks.length) anyRetrieval = true;

      const retrievedIds = chunks.map(c => chunkIdFromText(c.text)).filter(Boolean);
      row.retrieved = chunks.map((c, i) => ({
        id: chunkIdFromText(c.text),
        source: c.source,
        score: typeof c.score === 'number' ? round(c.score) : null,
        text_preview: (c.text || '').slice(0, 80),
      }));

      const rm = retrievalMetrics(retrievedIds, q.expected_source_ids || []);
      row.retrieval = { precision: round(rm.precision), recall: rm.recall === null ? null : round(rm.recall), f1: rm.f1 === null ? null : round(rm.f1), hits: rm.hitIds };
      row.top_score = row.retrieved[0]?.score ?? null;

      // 2. Build prompt exactly like routes/ask.js (no profile, no history in eval)
      const ragContext = formatChunksAsContext(chunks);
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT + ragContext },
        { role: 'user', content: q.question },
      ];

      // 3. Generate (non-streaming to capture token usage)
      const tGen0 = Date.now();
      const completion = await groq.chat.completions.create({
        model: GEN_MODEL,
        temperature: TEMPERATURE,
        messages,
      });
      row.generation_ms = Date.now() - tGen0;
      row.answer = completion.choices[0]?.message?.content || '';

      const usage = completion.usage || {};
      row.tokens = { prompt: usage.prompt_tokens ?? null, completion: usage.completion_tokens ?? null, total: usage.total_tokens ?? null };
      row.cost_usd = round(
        ((usage.prompt_tokens || 0) / 1e6) * PRICE_PER_M.input +
        ((usage.completion_tokens || 0) / 1e6) * PRICE_PER_M.output, 6);

      // 4. Naive key-fact coverage (proxy for answer quality; LLM-judge comes in Phase 1)
      row.fact_coverage = factCoverage(row.answer, q.key_facts);
      row.total_ms = (row.retrieval_ms || 0) + (row.generation_ms || 0);

      const rc = row.retrieval;
      const fc = row.fact_coverage;
      console.log(`  ${q.id} [${q.type}] P=${rc.precision} R=${rc.recall} facts=${fc ? fc.covered + '/' + fc.total : 'n/a'} ${row.total_ms}ms`);
    } catch (err) {
      row.error = err.message;
      console.log(`  ${q.id} [${q.type}] ERROR: ${err.message}`);
    }
    results.push(row);
  }

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const answerable = results.filter(r => (r.expected_source_ids || []).length > 0 && !r.error);
  const oos = results.filter(r => r.type === 'out_of_scope' && !r.error);

  const aggregate = {
    questions: results.length,
    retrieval_live: anyRetrieval,
    answerable_count: answerable.length,
    retrieval_precision_mean: round(mean(answerable.map(r => r.retrieval?.precision))),
    retrieval_recall_mean: round(mean(answerable.map(r => r.retrieval?.recall))),
    retrieval_f1_mean: round(mean(answerable.map(r => r.retrieval?.f1))),
    fact_coverage_mean: round(mean(answerable.map(r => r.fact_coverage?.ratio))),
    // For out-of-scope questions, ideally retrieval returns nothing relevant / low score.
    oos_count: oos.length,
    oos_retrieved_something_rate: oos.length ? round(mean(oos.map(r => (r.retrieved?.length ? 1 : 0)))) : null,
    oos_mean_top_score: oos.length ? round(mean(oos.map(r => r.top_score))) : null,
    latency_ms: {
      retrieval_mean: round(mean(results.map(r => r.retrieval_ms)), 1),
      generation_mean: round(mean(results.map(r => r.generation_ms)), 1),
      total_mean: round(mean(results.map(r => r.total_ms)), 1),
    },
    tokens: {
      prompt_total: results.reduce((a, r) => a + (r.tokens?.prompt || 0), 0),
      completion_total: results.reduce((a, r) => a + (r.tokens?.completion || 0), 0),
      total: results.reduce((a, r) => a + (r.tokens?.total || 0), 0),
    },
    cost_usd_total: round(results.reduce((a, r) => a + (r.cost_usd || 0), 0), 6),
    errors: results.filter(r => r.error).length,
  };

  const output = {
    label: LABEL,
    timestamp: new Date().toISOString(),
    config: { gen_model: GEN_MODEL, embed_model: EMBED_MODEL, top_k: TOP_K, temperature: TEMPERATURE, pricing_per_million: PRICE_PER_M, hybrid: false, rerank: false, metadata_filter: false },
    aggregate,
    results,
  };

  const runsDir = path.join(__dirname, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const stamp = output.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(runsDir, `${LABEL}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

  // ── Scorecard ─────────────────────────────────────────────────────────────
  console.log('\n──────────── BASELINE SCORECARD ────────────');
  if (!aggregate.retrieval_live) {
    console.log('⚠️  Retrieval returned 0 chunks for every question.');
    console.log('    Likely the MongoDB Atlas vector index is unavailable/unseeded.');
    console.log('    Generation numbers are still valid; retrieval metrics are not.');
  }
  console.log(`Questions           : ${aggregate.questions} (answerable ${aggregate.answerable_count}, out-of-scope ${aggregate.oos_count})`);
  console.log(`Retrieval P / R / F1: ${aggregate.retrieval_precision_mean} / ${aggregate.retrieval_recall_mean} / ${aggregate.retrieval_f1_mean}`);
  console.log(`Key-fact coverage   : ${aggregate.fact_coverage_mean}`);
  console.log(`OOS leak rate       : ${aggregate.oos_retrieved_something_rate} (retrieved something for out-of-scope Qs)`);
  console.log(`Latency mean (ms)   : retrieval ${aggregate.latency_ms.retrieval_mean} | gen ${aggregate.latency_ms.generation_mean} | total ${aggregate.latency_ms.total_mean}`);
  console.log(`Tokens              : ${aggregate.tokens.total} total (${aggregate.tokens.prompt_total} in / ${aggregate.tokens.completion_total} out)`);
  console.log(`Est. cost (USD)     : $${aggregate.cost_usd_total} for the run`);
  console.log(`Errors              : ${aggregate.errors}`);
  console.log(`\n📄 Saved: ${path.relative(process.cwd(), outPath)}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Baseline run failed:', err);
  process.exit(1);
});
