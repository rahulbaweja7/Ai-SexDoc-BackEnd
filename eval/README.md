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
# full 40-question baseline
npm run eval:baseline

# label a run (recommended so files are self-describing)
npm run eval:baseline -- --label baseline-grounded

# smoke test on the first N
node eval/runBaseline.js --limit 3 --label smoke
```

Requires `.env` with `GROQ_API_KEY`, `COHERE_API_KEY`, `MONGODB_URI`, `MONGODB_DB`.
Runs at `temperature=0` for reproducibility (production streams at default temp).

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
