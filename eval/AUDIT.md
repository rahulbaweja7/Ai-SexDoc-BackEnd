# SERA RAG Pipeline Audit — Phase 0 Baseline

_Snapshot of the pipeline **before** any upgrade work, so later phases can show measured deltas._

## Pipeline at a glance

```
user question
   │
   ▼
[embed query]  Cohere embed-english-v3.0, input_type=search_query → 1024-d vector   (utils/embed.js)
   │
   ▼
[retrieve]     MongoDB Atlas $vectorSearch, cosine, topK=3, numCandidates=30       (utils/retrieve.js)
   │
   ▼
[prompt build] SYSTEM_PROMPT + profile context + "Verified health information..." facts   (routes/ask.js)
   │
   ▼
[generate]     Groq llama-3.3-70b-versatile, streaming SSE                          (routes/ask.js)
   │
   ▼
answer (streamed token-by-token to the browser)
```

## 1. Ingestion

- **Source of truth:** `data/knowledge.json` — 23 hand-curated facts from **NHS** (14) and **Planned Parenthood** (9).
- **Ingest script:** `scripts/seedKnowledge.js` — clears the `knowledgechunks` collection, embeds each fact in batches of 20 with Cohere (`input_type=search_document`), and inserts `{ text, embedding, source, url, topic }` into MongoDB.
- **No automated document loading.** There is no crawler/loader/PDF parser — facts were written by hand. This means the "corpus" is small, clean, and already deduplicated.

## 2. Chunking

- **Strategy: none (pre-chunked by hand).** Each JSON entry _is_ a chunk — a single self-contained paragraph (~2–4 sentences).
- **Size:** ~40–75 words / ~55–90 tokens per chunk (no fixed token target, no splitter).
- **Overlap:** 0. Chunks are independent; no sliding window.
- **Method:** manual, one-fact-per-chunk. No recursive/semantic/token splitter.
- **Implication for Phase 2:** there is no chunking *algorithm* to tune yet. "Chunking experiments" here means (a) growing the corpus with a real loader + splitter, or (b) merging/splitting existing facts. The current setup is effectively an upper bound on chunk cleanliness and a lower bound on corpus size.

## 3. Embedding

- **Model:** Cohere `embed-english-v3.0`, `embeddingTypes: ['float']`, **1024 dimensions**.
- **Asymmetric input types:** `search_document` at seed time, `search_query` at query time (correct usage — Cohere trains these separately).
- **Store:** the 1024-float array lives in the `embedding` field of each Mongo document.

## 4. Retrieval

- **Method: pure vector search. Confirmed — NO keyword/BM25/hybrid component exists.** (`grep` for `$search`, `text`, `bm25`, `hybrid`, `rerank` in the pipeline returns nothing.)
- **Engine:** MongoDB Atlas `$vectorSearch` aggregation stage.
  - index: `knowledge_vector_index`, path: `embedding`, similarity: cosine
  - `topK = 3`, `numCandidates = topK * 10 = 30`
- **No re-ranking.** Chunks are passed to the LLM in raw similarity order.
- **No metadata filtering.** `topic`, `source`, and `url` are stored and returned but never used to filter or boost.
- **Fail-open:** if the vector index/DB is unavailable, `retrieveRelevantChunks` catches the error and returns `[]` — SERA still answers, just **without** grounding. This is a silent quality degradation with no signal to the user or logs beyond a `console.warn`.

## 5. Prompt construction

- Single system message = `SYSTEM_PROMPT` + `buildProfileContext(profile)` + `formatChunksAsContext(chunks)`.
- Retrieved facts are injected as:
  ```
  Verified health information from trusted sources:
  - "<chunk text>" (<source>)
  ```
- The last ≤20 turns of chat history are appended as prior messages, then the user turn.
- **No instruction forcing grounding.** The prompt says "answer like a knowledgeable friend" but does **not** tell the model to answer *only* from the provided facts or to cite them — so faithfulness is not enforced, only nudged. (This is exactly what Phase 1's faithfulness metric will quantify.)

## 6. Generation

- **Model:** Groq `llama-3.3-70b-versatile` via the OpenAI SDK (`baseURL: https://api.groq.com/openai/v1`).
- **Streaming:** yes, SSE token-by-token. **Token usage is not captured** in the streaming path (usage isn't emitted per-chunk), so the live app has **no cost/latency accounting today**.
- No temperature/max_tokens set explicitly (SDK/Groq defaults).

## 7. What is NOT present today (the gaps this upgrade targets)

| Capability | Status today |
|---|---|
| Evaluation / scoring | ❌ none (a `tests/rag/ragEval.test.js` exists but is a smoke test, not a scored harness) |
| Retrieval precision/recall measurement | ❌ none |
| Faithfulness / groundedness check | ❌ none |
| Hybrid (vector + keyword) search | ❌ pure vector only |
| Re-ranking | ❌ none |
| Metadata filtering/boosting | ❌ stored but unused |
| Agentic routing / decomposition / escalation | ❌ none — single-shot Q→A |
| Tool use beyond retrieval | ❌ none |
| Per-request tracing | ❌ only `utils/logger.js` info logs |
| Token cost tracking | ❌ none (streaming drops usage) |
| Output guardrails | ❌ none |

## 8. Baseline knobs (frozen for comparison)

| Knob | Value |
|---|---|
| Embedding model | cohere `embed-english-v3.0` (1024-d) |
| Vector index | `knowledge_vector_index`, cosine |
| topK | 3 |
| numCandidates | 30 |
| Generation model | groq `llama-3.3-70b-versatile` |
| Corpus size | 23 chunks |
| Hybrid / rerank / filter | none |

Any Phase 2+ change should move exactly one of these knobs at a time and be re-scored against `eval/golden-set.json` so the delta is attributable.

## 9. 🔴 Critical finding from the baseline run

Running `eval/runBaseline.js` surfaced that **retrieval is entirely non-functional today**:

- The corpus **is** seeded correctly — 23 chunks, each with a valid 1024-d embedding.
- But the Atlas search index `knowledge_vector_index` has **`status: FAILED`, `queryable: false`**.
- Root cause: its definition sets `"similarity": "cosine|dotProduct|euclidean"` — the docs
  placeholder (the list of allowed values) was pasted in as the literal value. Atlas rejected the build.
- Consequently `$vectorSearch` returns 0 rows for every query, and because `retrieve.js`
  swallows the failure (`return []`), **SERA answers every question with zero grounding** and no user-facing or logged error.

### Baseline numbers (Run A — `baseline-ungrounded`, 40 questions)

| Metric | Value |
|---|---|
| Retrieval precision / recall / F1 | **0 / 0 / 0** (index FAILED) |
| Key-fact coverage (naive substring proxy) | 0.23 |
| Mean generation latency | ~1050 ms |
| Mean total latency | ~1234 ms |
| Tokens (40 Q) | 9,139 (5,407 in / 3,732 out) |
| Est. cost (40 Q) | ~$0.006 |

Fix: `node eval/fixVectorIndex.js` → recreates the index with `similarity: "cosine"` →
then `npm run eval:baseline -- --label baseline-grounded` for Run B (grounded), which
becomes the real vector-retrieval baseline that Phase 2 improves on.

### Run A → Run B (index fixed) — first quantified win

| Metric | Run A (broken index) | Run B (grounded) |
|---|---|---|
| Retrieval recall | **0.0%** | **98.6%** |
| Retrieval precision | 0.0% | 38.0% |
| Retrieval F1 | 0.0 | 0.539 |
| Key-fact coverage (naive proxy) | 23.0% | **53.3%** |
| Mean total latency | 1234 ms | 1208 ms |
| Tokens (40 Q) | 9,139 | 16,474 |
| Cost / run | $0.0061 | $0.0104 |

**Fixing the misconfigured index recovered retrieval grounding from 0% → 98.6% recall,
and more than doubled answer key-fact coverage (23% → 53%)** — at the cost of ~80% more
input tokens (the injected chunks) and a small ($0.004/run) cost increase, with no
latency penalty.

### Two findings that pre-seed later phases

1. **Precision is capped by fixed `topK=3`.** Most questions have 1 expected chunk, so
   returning 3 caps precision at ~0.33 even when recall is perfect. → Phase 2 (re-ranking /
   dynamic-k / metadata filtering) is where precision should climb.
2. **Out-of-scope leak = 100%.** Vector search always returns its 3 nearest neighbours, so
   every out-of-scope question ("best pizza topping?") still pulls 3 chunks. But the **top-1
   similarity score separates the two populations cleanly**:
   - answerable: min/mean/max = **0.753 / 0.835 / 0.898**
   - out-of-scope: min/mean/max = **0.621 / 0.670 / 0.695**
   A score threshold ≈ **0.72** would separate in-scope from out-of-scope. → This is the concrete
   signal Phase 3's confidence-based escalation / "decline to guess" guardrail will use.
