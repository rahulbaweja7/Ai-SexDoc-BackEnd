/**
 * runEval.js — Phase 1 evaluation harness (LLM-as-judge).
 *
 * For each golden question:
 *   1. run the current pipeline (retrieve → generate), mirroring routes/ask.js
 *   2. score retrieval precision/recall/F1 against golden labels (deterministic)
 *   3. LLM-judge faithfulness + answer relevance (out-of-scope → refusal check)
 *   4. record latency, and generation vs judge token cost separately
 *
 * Output: eval/runs/eval-{label}-{timestamp}.json + a console scorecard.
 *
 * Usage:
 *   npm run eval                       # full set
 *   npm run eval -- --label after-hybrid
 *   node eval/runEval.js --limit 5     # smoke
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const connectToMongo = require('../utils/mongodb');
const { retrieveRelevantChunks, formatChunksAsContext } = require('../utils/retrieve');
const { loadCorpusIndex, retrievalMetrics, mean, round, costUsd } = require('./lib/metrics');
const { judgeFaithfulness, judgeRelevance, judgeRefusal, JUDGE_MODEL, JUDGE_PRICE_PER_M } = require('./judge');

// ── Frozen config (mirrors routes/ask.js) ──
const GEN_MODEL = 'llama-3.3-70b-versatile';
const EMBED_MODEL = 'cohere embed-english-v3.0 (1024d)';
const TOP_K = 3;
const TEMPERATURE = 0; // eval reproducibility
const GEN_PRICE_PER_M = { input: 0.59, output: 0.79 };

const SYSTEM_PROMPT = `You are SERA — a warm, non-judgmental sexual health guide. Answer like a knowledgeable friend: honest, concise, never preachy. Keep responses short and conversational — 2 to 4 sentences unless the question genuinely needs more detail. Use plain language, no unnecessary lists or headers. If someone seems distressed, acknowledge their feelings first. Topics: sexual health, relationships, contraception, STIs, anatomy, intimacy.`;

// ── CLI ──
const args = process.argv.slice(2);
const argVal = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const LIMIT = parseInt(argVal('--limit', '0'), 10) || 0;
const LABEL = argVal('--label', 'eval');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf8'));
const { idFromText } = loadCorpusIndex();

function addUsage(acc, usage) {
  acc.prompt += usage?.prompt_tokens || 0;
  acc.completion += usage?.completion_tokens || 0;
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY not set — required for generation and judging.');
    process.exit(1);
  }
  const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  await connectToMongo();

  let questions = golden.questions;
  if (LIMIT) questions = questions.slice(0, LIMIT);

  console.log(`\n▶ Phase 1 eval "${LABEL}" over ${questions.length} question(s)`);
  console.log(`  gen=${GEN_MODEL}  judge=${JUDGE_MODEL}  topK=${TOP_K}  temp=${TEMPERATURE}\n`);

  const results = [];
  const genUsage = { prompt: 0, completion: 0 };
  const judgeUsage = { prompt: 0, completion: 0 };
  let anyRetrieval = false;

  for (const q of questions) {
    const row = { id: q.id, question: q.question, type: q.type, topic: q.topic, expected_source_ids: q.expected_source_ids };
    try {
      // 1. Retrieve
      const tRet0 = Date.now();
      const chunks = await retrieveRelevantChunks(q.question, TOP_K);
      row.retrieval_ms = Date.now() - tRet0;
      if (chunks.length) anyRetrieval = true;
      const retrievedIds = chunks.map((c) => idFromText(c.text)).filter(Boolean);
      row.retrieved = chunks.map((c) => ({ id: idFromText(c.text), source: c.source, score: typeof c.score === 'number' ? round(c.score) : null }));
      const rm = retrievalMetrics(retrievedIds, q.expected_source_ids || []);
      row.retrieval = { precision: round(rm.precision), recall: rm.recall === null ? null : round(rm.recall), f1: rm.f1 === null ? null : round(rm.f1) };
      row.top_score = row.retrieved[0]?.score ?? null;

      // 2. Generate (non-streaming for usage capture)
      const ragContext = formatChunksAsContext(chunks);
      const tGen0 = Date.now();
      const completion = await groq.chat.completions.create({
        model: GEN_MODEL,
        temperature: TEMPERATURE,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + ragContext },
          { role: 'user', content: q.question },
        ],
      });
      row.generation_ms = Date.now() - tGen0;
      row.answer = completion.choices[0]?.message?.content || '';
      addUsage(genUsage, completion.usage);
      row.gen_cost_usd = costUsd(completion.usage, GEN_PRICE_PER_M);

      // 3. LLM-judge
      const tJudge0 = Date.now();
      const rel = await judgeRelevance(q.question, row.answer);
      addUsage(judgeUsage, rel.usage);
      row.relevance = { score: round(rel.score), rating: rel.rating, reason: rel.reason };

      if (q.type === 'out_of_scope') {
        const ref = await judgeRefusal(q.question, row.answer);
        addUsage(judgeUsage, ref.usage);
        row.refusal = { appropriate: ref.appropriate, reason: ref.reason };
      } else {
        const faith = await judgeFaithfulness(row.answer, chunks);
        addUsage(judgeUsage, faith.usage);
        row.faithfulness = { score: faith.score === null ? null : round(faith.score), supported: faith.supported, total: faith.total, claims: faith.claims };
      }
      row.judge_ms = Date.now() - tJudge0;
      row.total_ms = (row.retrieval_ms || 0) + (row.generation_ms || 0);

      const f = row.faithfulness ? row.faithfulness.score : `refusal=${row.refusal?.appropriate}`;
      console.log(`  ${q.id} [${q.type}] faith=${f} rel=${row.relevance.score} R=${row.retrieval.recall} ${row.total_ms}ms`);
    } catch (err) {
      row.error = err.message;
      console.log(`  ${q.id} [${q.type}] ERROR: ${err.message}`);
    }
    results.push(row);
  }

  // ── Aggregates ──
  const ok = results.filter((r) => !r.error);
  const answerable = ok.filter((r) => r.type !== 'out_of_scope');
  const oos = ok.filter((r) => r.type === 'out_of_scope');

  const genCost = costUsd({ prompt_tokens: genUsage.prompt, completion_tokens: genUsage.completion }, GEN_PRICE_PER_M);
  const judgeCost = costUsd({ prompt_tokens: judgeUsage.prompt, completion_tokens: judgeUsage.completion }, JUDGE_PRICE_PER_M);

  const aggregate = {
    questions: results.length,
    retrieval_live: anyRetrieval,
    faithfulness_mean: round(mean(answerable.map((r) => r.faithfulness?.score))),
    answer_relevance_mean: round(mean(ok.map((r) => r.relevance?.score))),
    retrieval_precision_mean: round(mean(answerable.map((r) => r.retrieval?.precision))),
    retrieval_recall_mean: round(mean(answerable.map((r) => r.retrieval?.recall))),
    retrieval_f1_mean: round(mean(answerable.map((r) => r.retrieval?.f1))),
    oos_count: oos.length,
    oos_appropriate_refusal_rate: oos.length ? round(mean(oos.map((r) => (r.refusal?.appropriate ? 1 : 0)))) : null,
    latency_ms: {
      retrieval_mean: round(mean(results.map((r) => r.retrieval_ms)), 1),
      generation_mean: round(mean(results.map((r) => r.generation_ms)), 1),
      total_mean: round(mean(results.map((r) => r.total_ms)), 1),
    },
    cost_usd: { generation: genCost, judge: judgeCost, total: round((genCost || 0) + (judgeCost || 0), 6) },
    errors: results.filter((r) => r.error).length,
  };

  const output = {
    label: LABEL,
    timestamp: new Date().toISOString(),
    config: { gen_model: GEN_MODEL, judge_model: JUDGE_MODEL, embed_model: EMBED_MODEL, top_k: TOP_K, temperature: TEMPERATURE, hybrid: false, rerank: false, metadata_filter: false },
    aggregate,
    results,
  };

  const runsDir = path.join(__dirname, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const stamp = output.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(runsDir, `eval-${LABEL}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

  const a = aggregate;
  console.log('\n──────────── PHASE 1 EVAL SCORECARD ────────────');
  if (!a.retrieval_live) console.log('⚠️  Retrieval returned 0 chunks for every question — is the vector index queryable?');
  console.log(`Questions              : ${a.questions} (answerable ${answerable.length}, out-of-scope ${a.oos_count})`);
  console.log(`Faithfulness           : ${a.faithfulness_mean}   (claims supported by retrieved sources)`);
  console.log(`Answer relevance       : ${a.answer_relevance_mean}`);
  console.log(`Retrieval P / R / F1   : ${a.retrieval_precision_mean} / ${a.retrieval_recall_mean} / ${a.retrieval_f1_mean}`);
  console.log(`OOS refusal (correct)  : ${a.oos_appropriate_refusal_rate}`);
  console.log(`Latency mean (ms)      : retr ${a.latency_ms.retrieval_mean} | gen ${a.latency_ms.generation_mean} | total ${a.latency_ms.total_mean}`);
  console.log(`Cost (USD)             : gen $${a.cost_usd.generation} + judge $${a.cost_usd.judge} = $${a.cost_usd.total}`);
  console.log(`Errors                 : ${a.errors}`);
  console.log(`\n📄 Saved: ${path.relative(process.cwd(), outPath)}\n`);
  process.exit(0);
}

main().catch((err) => { console.error('❌ Eval run failed:', err); process.exit(1); });
