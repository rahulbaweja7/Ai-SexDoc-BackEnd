# SERA Upgrade Log

A running summary of the RAG upgrade work (see `UPGRADE_PLAN.MD` at the repo root
for the original plan). Updated at the end of each phase. Most recent metrics live
in the snapshot table at the bottom.

Repo: `Ai-SexDoc-BackEnd` · all work pushed to `origin/main`.

---

## Current metrics snapshot

| Metric | Before | Now | Where it moved |
|---|---|---|---|
| Retrieval grounding (recall) | 0% (index broken) | 98.6% | Phase 0 fix |
| Retrieval precision | 38% | **90%** | Phase 2 |
| Faithfulness (answers backed by sources) | 92.8% | 94.1% | Phase 2 |
| Answer relevance | 100% | 100% | — |
| Out-of-scope junk chunks pulled in | 3 per question | **0** | Phase 2 |
| Agent routing accuracy | n/a | **97.5%** | Phase 3 |
| Safety routing (decline + emergency) | n/a | **100%** | Phase 3 |

---

## Pre-phase: security + cleanup  (`8d1a9fc`)

Hardening found while getting oriented, before the plan work began.

- **Removed an insecure hardcoded `JWT_SECRET` fallback** (a known default string would
  have let anyone forge login tokens); server now refuses to start without a real secret.
- **Scrubbed a live MongoDB connection string** (with credentials) from `README.md`.
- Added `.env.example`; stopped git-ignoring it.
- **Deleted a dead legacy OpenAI/Whisper code path** (`api/chat.js`, `chatWithLLM.js`,
  `transcribeAudio.js`, `Conversation` model, stray test scripts) so only the current
  Groq path remains.
- Fixed a mislabeled rate-limiter comment; pointed the `dev` script at `server.js`.

> ⚠️ Follow-up still open: rotate the API keys / DB credentials that were previously in
> the repo (removing them from files doesn't remove them from git history).

---

## Phase 0 — Audit & baseline  (`ccd01aa`)

**Goal:** measure the pipeline as-is before changing anything.

**What was built** (`eval/`):
- `AUDIT.md` — snapshot of the pipeline (chunking = none / hand-authored, retrieval =
  pure vector, no hybrid/rerank/filter) + a gap table.
- `golden-set.json` — **40 labelled test questions** (factual, lay-paraphrase, multi-hop,
  out-of-scope) with the corpus chunks each should retrieve + key facts.
- `corpus.json` — the 23 knowledge chunks with stable ids `c00`–`c22`.
- `runBaseline.js` (`npm run eval:baseline`) — scores retrieval, latency, token cost.
- `fixVectorIndex.js` — repair script for the Atlas vector index.

**🔴 Key finding:** the Atlas `knowledge_vector_index` build had **FAILED** (its
definition literally contained the docs placeholder `"cosine|dotProduct|euclidean"`).
`$vectorSearch` was silently returning 0 rows, so **SERA had been answering with no RAG
grounding at all.** Fixing the index recovered retrieval recall **0% → 98.6%** and
doubled answer key-fact coverage.

---

## Phase 1 — Evaluation harness (LLM-as-judge)  (`706a546`)

**Goal:** replace crude keyword-matching grading with a grader that understands meaning.

**What was built** (`eval/`):
- `judge.js` — a second LLM (Groq) scores each answer for **faithfulness** (are the
  answer's claims supported by the retrieved sources? — claim by claim),
  **answer relevance**, and **appropriate refusal** for out-of-scope questions.
- `runEval.js` (`npm run eval`) — runs the pipeline + judge, separates generation vs
  judge token cost.
- `lib/metrics.js` — shared deterministic scoring helpers.

**Result (40 Q):** faithfulness **0.919**, answer relevance **0.975**, out-of-scope
appropriate-refusal **1.00**. The harness flagged 6/36 answerable questions with an
unsupported claim (e.g. an invented "start the mini pill 6 weeks after giving birth").

> No app behaviour changed in this phase — it only made measurement trustworthy.

---

## Phase 2 — Retrieval quality (rerank + threshold)  (`9c5f1ca`)

**Goal:** raise retrieval precision (was 38% — grabbing 3 chunks when usually 1 is right).

**What changed:**
- `utils/retrieve.js` — new `retrieve()`: over-fetch 10 candidates by vector, **rerank
  with Cohere `rerank-v3.5`**, keep only chunks scoring ≥ 0.3 (adaptive: 1 for simple
  Qs, 2–3 for multi-part, **0 for off-topic**). Fail-safe fallback to vector top-k if
  rerank is unavailable. Raw `retrieveRelevantChunks()` kept as the eval baseline.
- `routes/ask.js` — live chat now uses `retrieve()`.
- `eval/retrievers.js` + `runEval.js` — `--retriever` flag; the rerank strategy
  **delegates to the same production `retrieve()`** so eval tests exactly what ships.

**Result (before → after):** precision **38% → 90%**, recall held at 98.6%, faithfulness
92.8% → 94.1%, out-of-scope chunk leak **3 → 0**. Fewer chunks → smaller prompts → the
live app uses *fewer* Groq tokens, not more.

---

## Phase 3 — Agentic layer (LangGraph.js)  (`bb17cce`)

**Goal:** give SERA judgment — route each message instead of answering everything the same.

**What was built:**
- `agent/graph.js` — a **LangGraph.js** state graph:
  `retrieve → triage → { emergency | decline | decompose | answer } → tool → generate`.
- `agent/tools.js` — emergency detection, multi-part splitting, and a deterministic
  **structured-fact lookup** (supplies exact numbers instead of trusting the LLM).
- `routes/agent.js` + `server.js` — `POST /agent` (non-streaming JSON). The streaming
  `/ask` route is unchanged.
- `eval/runAgent.js` (`npm run eval:agent`) — routing accuracy, **no LLM calls** (free).

**Design:** triage uses rules + Phase 2 rerank confidence (no LLM); emergency/decline
replies are canned (0 Groq tokens); only the `generate` node calls Groq.

**Result:** routing accuracy **97.5%** (39/40); **safety routes (decline + emergency)
100%** — every off-topic question declined, the "chest pain / numb arm" emergency
escalated to real help.

> **Live in the real chat.** The streaming `/ask` route was upgraded to run the
> agent's brain (triage → decline/escalate/decompose → tool → stream) rather than
> repointing the front-end at `/agent`. So users get routing + escalation with no
> front-end change, and normal answers still stream word-by-word. `/agent`
> (non-streaming JSON) remains for the eval + API use.

---

## Still to do

- **Phase 4 — Observability:** per-request tracing (chunks, prompt, tokens, latency),
  token-cost tracking, a small dashboard, output guardrails.
- **Phase 5 — Redeploy + CI:** redeploy the upgraded backend; run the eval suite on every
  push and fail the build if faithfulness/retrieval scores regress.
- **Housekeeping:** rotate previously-exposed secrets; `node_modules` is committed to the
  repo (pre-existing) and could be untracked.
- **Finish the Phase 2 answer-quality pass** on the 15 questions skipped when the Groq
  free daily token limit was hit mid-run.

---

## How to run the graders

```bash
npm run eval:baseline   # Phase 0 deterministic baseline
npm run eval            # Phase 1 LLM-as-judge (faithfulness, relevance)
npm run eval:agent      # Phase 3 routing accuracy (no LLM calls, free)
```
Raw results are saved under `eval/runs/`. See `eval/README.md` for details.
