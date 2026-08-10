# SERA Evaluation Harness (`/eval`)

The measurement backbone for the SERA RAG upgrade. Phase 0 establishes the
"before" snapshot; later phases re-run the same golden set so every change has
an attributable delta.

## Files

| File | Purpose |
|---|---|
| `AUDIT.md` | Snapshot of the pipeline **before** any changes (chunking, retrieval, gaps). |
| `corpus.json` | The 23 knowledge chunks with stable ids `c00`–`c22` (generated from `data/knowledge.json`). The join key between golden set and retrieved chunks. |
| `golden-set.json` | 40 user-style questions, each tagged with the corpus chunk ids that *should* be retrieved + key facts a faithful answer must contain. |
| `runBaseline.js` | Runs the golden set through the current pipeline, scores retrieval P/R + naive fact coverage, records latency + token cost, writes a run file. |
| `fixVectorIndex.js` | One-off repair for the misconfigured Atlas vector index (run manually — it's a DB schema change). |
| `runs/` | Timestamped raw results, one JSON per run. Committed so runs can be diffed over time. |

## Golden set schema

```jsonc
{
  "id": "q06",
  "question": "What is the most common STI in the UK?",
  "topic": "STIs",
  "type": "factual",              // factual | lay_paraphrase | multi_hop | out_of_scope
  "expected_source_ids": ["c05"], // corpus chunks that SHOULD be retrieved
  "key_facts": ["chlamydia", "often has no symptoms", "treated with antibiotics"],
  "expected_behavior": "answer"  // or "decline_or_no_source" for out_of_scope
}
```

Question mix: 23 factual, 8 lay-paraphrase (colloquial phrasing vs. medical terms —
stresses retrieval), 5 multi-hop (needs ≥2 chunks — sets up Phase 3 decomposition),
4 out-of-scope (should retrieve nothing / decline — sets up Phase 3 escalation).

## Metrics (Phase 0)

- **Retrieval precision** = relevant retrieved / total retrieved
- **Retrieval recall** = relevant retrieved / total relevant (per golden labels)
- **Retrieval F1** = harmonic mean of the two
- **Key-fact coverage** = fraction of a question's `key_facts` that appear (substring) in the answer.
  ⚠️ This is a deliberately *naive* proxy for the "before" number — it undercounts because it
  requires exact substrings (e.g. the model says "over 99%" but the fact string is "more than 99%").
  **Phase 1 replaces it with an LLM-as-judge faithfulness + answer-relevance score.**
- **Latency** per stage (retrieval, generation) and **token usage + estimated cost**.

## Running

```bash
# Phase 0 — deterministic baseline (keyword-level fact coverage, no LLM judge)
npm run eval:baseline -- --label baseline-grounded

# Phase 1 — full harness with LLM-as-judge (faithfulness + relevance + refusal)
npm run eval -- --label grounded

# smoke test on the first N
node eval/runEval.js --limit 3 --label smoke
```

Requires `.env` with `GROQ_API_KEY`, `COHERE_API_KEY`, `MONGODB_URI`, `MONGODB_DB`.
Runs at `temperature=0` for reproducibility (production streams at default temp).

## Phase 1 — LLM-as-judge metrics

`runBaseline.js` (Phase 0) scored answers by **exact-substring** keyword matching — it
undercounts because "over 99%" ≠ "more than 99%". Phase 1 (`runEval.js` + `judge.js`)
replaces that with a **second LLM acting as judge**, scoring *meaning* not words:

| Metric | Question the judge answers | How |
|---|---|---|
| **Faithfulness** | Is every factual claim in the answer supported by the retrieved sources? | Judge extracts each claim, marks supported/unsupported; score = supported/total. RAGAS-style. |
| **Answer relevance** | Does the answer actually address the question? | 1–5 rating → 0–1. |
| **Appropriate refusal** | For out-of-scope questions, did it decline/redirect instead of fabricating? | boolean, out-of-scope only. |

Retrieval P/R/F1 stays deterministic (scored against golden labels — stronger than
RAGAS's LLM-estimated context metrics because we have ground-truth chunk ids).

### Phase 1 baseline results (`eval-grounded`, 40 Q, index fixed)

| Metric | Score |
|---|---|
| **Faithfulness** | **0.919** |
| **Answer relevance** | **0.975** |
| Retrieval precision / recall / F1 | 0.380 / 0.986 / 0.539 |
| Out-of-scope appropriate refusal | **1.00** (4/4) |
| Mean total latency | ~2.4 s (noisy; judge adds no latency to the product) |
| Cost / run | gen $0.010 + judge $0.020 = **$0.030** |

The harness flagged **6 of 36** answerable questions as containing ≥1 unsupported claim —
e.g. inventing "start the mini pill 6 weeks after giving birth" (not in sources). These are
real ungrounded additions the faithfulness metric is designed to catch.

### Caveats (be honest about these in interviews)

- **Self-grading bias:** judge and generator are the same model (`llama-3.3-70b-versatile`).
  Set `JUDGE_MODEL` to a different model to reduce this. Faithfulness may be slightly optimistic.
- **Empathy over-flagging:** the judge sometimes marks empathy sentences ("that can be upsetting")
  as unsupported claims, which slightly *depresses* faithfulness — partially offsetting the bias above.
- Latency is wall-clock and network-noisy; treat it as a rough trend, not a precise SLA.
- Retrieval precision is capped ~0.33 by fixed `topK=3` (Phase 2 target).

## ⚠️ Phase 0 finding: the vector index was broken

The Atlas `knowledge_vector_index` was built with an invalid similarity value
(`"cosine|dotProduct|euclidean"` — the docs placeholder pasted verbatim), so its
status is `FAILED` and `$vectorSearch` silently returns 0 rows. Because
`utils/retrieve.js` fails open, **SERA has been running with no RAG grounding**.

- **Run A — `baseline-ungrounded`** was captured against this broken state
  (retrieval P/R = 0): it is the true "before", and also a clean *ungrounded generation*
  baseline to compare grounded answers against.
- **To fix:** `node eval/fixVectorIndex.js`, then
  `npm run eval:baseline -- --label baseline-grounded` for **Run B** (grounded).

The A→B delta ("recovered retrieval grounding from 0% to X%") is the first
quantified win of the upgrade.
