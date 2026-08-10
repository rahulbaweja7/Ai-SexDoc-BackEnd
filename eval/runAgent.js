/**
 * runAgent.js — Phase 3 eval: measures the agent's ROUTING accuracy.
 *
 * Routing is the headline of the agentic layer: does SERA send each question to
 * the right path (answer / decompose / decline / emergency)? This uses
 * classifyRoute (retrieve + triage only) so it makes NO LLM calls — it can run
 * the full golden set for free, regardless of the Groq daily token budget.
 *
 * Expected route is derived from each golden question's type:
 *   out_of_scope + emergency wording → emergency
 *   out_of_scope                     → decline
 *   multi_hop                        → decompose
 *   factual / lay_paraphrase         → answer
 *
 * Usage: node eval/runAgent.js [--label routing]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const connectToMongo = require('../utils/mongodb');
const { classifyRoute } = require('../agent/graph');
const { isEmergency } = require('../agent/tools');
const { round } = require('./lib/metrics');

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const LABEL = argVal('--label', 'routing');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf8'));

function expectedRoute(q) {
  if (q.type === 'out_of_scope') return isEmergency(q.question) ? 'emergency' : 'decline';
  if (q.type === 'multi_hop') return 'decompose';
  return 'answer';
}

async function main() {
  await connectToMongo();
  console.log(`\n▶ Agent routing eval "${LABEL}" over ${golden.questions.length} question(s) (no LLM calls)\n`);

  const results = [];
  for (const q of golden.questions) {
    const exp = expectedRoute(q);
    let got, topScore;
    try {
      const r = await classifyRoute(q.question);
      got = r.route; topScore = round(r.topScore);
    } catch (e) { got = `ERROR:${e.message.slice(0, 40)}`; }
    const correct = got === exp;
    results.push({ id: q.id, type: q.type, expected: exp, got, correct, topScore });
    console.log(`  ${q.id} [${q.type}] expected=${exp} got=${got} ${correct ? '✓' : '✗'}`);
  }

  // ── Aggregates ──
  const n = results.length;
  const correct = results.filter((r) => r.correct).length;
  const byType = {};
  for (const r of results) {
    const t = r.type;
    byType[t] = byType[t] || { total: 0, correct: 0 };
    byType[t].total++; if (r.correct) byType[t].correct++;
  }
  // Safety-critical views
  const oos = results.filter((r) => r.expected === 'decline' || r.expected === 'emergency');
  const oosCorrect = oos.filter((r) => r.correct).length;

  const aggregate = {
    questions: n,
    routing_accuracy: round(correct / n),
    by_type: Object.fromEntries(Object.entries(byType).map(([t, v]) => [t, round(v.correct / v.total)])),
    safety_route_accuracy: oos.length ? round(oosCorrect / oos.length) : null, // decline+emergency
    confusion: results.filter((r) => !r.correct).map((r) => ({ id: r.id, expected: r.expected, got: r.got })),
  };

  const output = { label: LABEL, timestamp: new Date().toISOString(), aggregate, results };
  const runsDir = path.join(__dirname, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const stamp = output.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(runsDir, `agent-${LABEL}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

  console.log('\n──────────── AGENT ROUTING SCORECARD ────────────');
  console.log(`Overall routing accuracy : ${aggregate.routing_accuracy}`);
  Object.entries(aggregate.by_type).forEach(([t, v]) => console.log(`  ${t.padEnd(14)}: ${v}`));
  console.log(`Safety routes (decline+emergency): ${aggregate.safety_route_accuracy}`);
  if (aggregate.confusion.length) {
    console.log('Misroutes:');
    aggregate.confusion.forEach((c) => console.log(`  ${c.id}: expected ${c.expected}, got ${c.got}`));
  }
  console.log(`\n📄 Saved: ${path.relative(process.cwd(), outPath)}\n`);
  process.exit(0);
}

main().catch((e) => { console.error('❌ Agent eval failed:', e); process.exit(1); });
