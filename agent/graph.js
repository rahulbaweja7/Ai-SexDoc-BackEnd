/**
 * graph.js — the SERA agentic layer, built with LangGraph.js.
 *
 * Instead of one straight line (question → answer), the agent routes each
 * message through a small graph with decision points:
 *
 *   START → retrieve → triage ─┬─ emergency → (canned crisis response) → END
 *                              ├─ decline   → (canned out-of-scope reply) → END
 *                              ├─ decompose → tool → answer → END
 *                              └─ answer    → tool → answer → END
 *
 * Design choices that keep it cheap and safe:
 *   - triage uses rules + retrieval confidence (Phase 2 rerank scores) — no LLM call
 *   - emergency/decline responses are canned — no LLM call, fully deterministic
 *   - a structured fact tool supplies exact numbers instead of trusting the LLM
 *   - only the `answer` node calls Groq, so Groq usage is <= the old pipeline
 */

const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
const { OpenAI } = require('openai');
const { retrieve, formatChunksAsContext } = require('../utils/retrieve');
const { buildProfileContext, SYSTEM_PROMPT } = require('../routes/ask');
const { isEmergency, isMultiPart, splitParts, factLookup, EMERGENCY_REPLY, DECLINE_REPLY } = require('./tools');

const GEN_MODEL = 'llama-3.3-70b-versatile';

let groq = null;
function getGroq() {
  if (groq) return groq;
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is missing');
  groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  return groq;
}

// ── Graph state ──────────────────────────────────────────────────────────────
const S = Annotation.Root({
  question: Annotation(),
  history: Annotation(),
  profile: Annotation(),
  chunks: Annotation({ reducer: (_a, b) => b, default: () => [] }),
  topScore: Annotation(),
  route: Annotation(),
  structuredFacts: Annotation({ reducer: (_a, b) => b, default: () => [] }),
  answer: Annotation(),
  trace: Annotation({ reducer: (a, b) => [...(a || []), ...(b || [])], default: () => [] }),
});

// ── Nodes ────────────────────────────────────────────────────────────────────
async function retrieveNode(state) {
  const chunks = await retrieve(state.question);
  const topScore = chunks[0]?.rerankScore ?? chunks[0]?.score ?? 0;
  return { chunks, topScore, trace: [`retrieve: ${chunks.length} chunk(s), top=${topScore.toFixed?.(2) ?? topScore}`] };
}

function triageNode(state) {
  if (isEmergency(state.question)) return { route: 'emergency', trace: ['triage → emergency'] };
  if (!state.chunks.length) return { route: 'decline', trace: ['triage → decline (no confident sources)'] };
  if (isMultiPart(state.question)) return { route: 'decompose', trace: ['triage → decompose (multi-part)'] };
  return { route: 'answer', trace: ['triage → answer'] };
}

async function decomposeNode(state) {
  const parts = splitParts(state.question);
  const perPart = await Promise.all(parts.map((p) => retrieve(p)));
  const seen = new Set();
  const merged = [];
  for (const list of perPart) {
    for (const c of list) {
      if (!seen.has(c.text)) { seen.add(c.text); merged.push(c); }
    }
  }
  return { chunks: merged.slice(0, 4), trace: [`decompose: ${parts.length} parts → ${merged.length} unique chunk(s)`] };
}

function toolNode(state) {
  const facts = factLookup(state.question);
  return { structuredFacts: facts, trace: [facts.length ? `tool: factLookup → ${facts.length} verified fact(s)` : 'tool: no structured facts'] };
}

async function answerNode(state) {
  const ragContext = formatChunksAsContext(state.chunks);
  const toolContext = state.structuredFacts?.length
    ? `\n\nVerified exact figures (use these numbers precisely):\n${state.structuredFacts.map((f) => `- ${f}`).join('\n')}`
    : '';
  const priorMessages = Array.isArray(state.history)
    ? state.history.slice(-20).map((m) => ({ role: m.sender === 'You' ? 'user' : 'assistant', content: m.content }))
    : [];
  const completion = await getGroq().chat.completions.create({
    model: GEN_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + buildProfileContext(state.profile) + ragContext + toolContext },
      ...priorMessages,
      { role: 'user', content: state.question },
    ],
  });
  return { answer: completion.choices[0]?.message?.content || '', trace: ['answer: generated'] };
}

function emergencyNode() {
  return { answer: EMERGENCY_REPLY, trace: ['emergency: canned crisis response'] };
}

function declineNode() {
  return { answer: DECLINE_REPLY, trace: ['decline: canned out-of-scope reply'] };
}

// ── Assemble the graph ───────────────────────────────────────────────────────
const workflow = new StateGraph(S)
  .addNode('retrieve', retrieveNode)
  .addNode('triage', triageNode)
  .addNode('decompose', decomposeNode)
  .addNode('tool', toolNode)
  .addNode('generate', answerNode)
  .addNode('emergency', emergencyNode)
  .addNode('decline', declineNode)
  .addEdge(START, 'retrieve')
  .addEdge('retrieve', 'triage')
  .addConditionalEdges('triage', (state) => state.route, {
    emergency: 'emergency',
    decline: 'decline',
    decompose: 'decompose',
    answer: 'tool',
  })
  .addEdge('decompose', 'tool')
  .addEdge('tool', 'generate')
  .addEdge('generate', END)
  .addEdge('emergency', END)
  .addEdge('decline', END);

const app = workflow.compile();

/**
 * Run the agent for one message.
 * @returns {{ route, answer, chunks, structuredFacts, topScore, trace }}
 */
async function runAgent(question, { history = [], profile = {} } = {}) {
  const final = await app.invoke({ question, history, profile });
  return {
    route: final.route || (isEmergency(question) ? 'emergency' : 'unknown'),
    answer: final.answer || '',
    chunks: final.chunks || [],
    structuredFacts: final.structuredFacts || [],
    topScore: final.topScore ?? 0,
    trace: final.trace || [],
  };
}

/**
 * Classify a question's route WITHOUT generating an answer (no LLM call).
 * Used by the eval to measure routing accuracy cheaply.
 * @returns {{ route, chunks, topScore }}
 */
async function classifyRoute(question) {
  const chunks = await retrieve(question);
  const { route } = triageNode({ question, chunks });
  return { route, chunks, topScore: chunks[0]?.rerankScore ?? chunks[0]?.score ?? 0 };
}

module.exports = { runAgent, classifyRoute, app };
