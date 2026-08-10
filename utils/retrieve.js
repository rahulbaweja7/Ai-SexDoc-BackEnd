const mongoose = require('mongoose');
const KnowledgeChunk = require('./models/KnowledgeChunk');
const { embedText } = require('./embed');
const { CohereClientV2 } = require('cohere-ai');

// Production retrieval defaults (validated in eval Phase 2).
const RERANK_MODEL = 'rerank-v3.5';
const RERANK_CANDIDATES = 10; // over-fetch by vector, then rerank down
const RERANK_MAX_K = 3;       // most chunks to keep after reranking
const RERANK_MIN_SCORE = 0.3; // drop chunks below this rerank relevance

let cohereClient = null;
function getCohere() {
  if (cohereClient) return cohereClient;
  if (!process.env.COHERE_API_KEY) throw new Error('COHERE_API_KEY not set');
  cohereClient = new CohereClientV2({ token: process.env.COHERE_API_KEY });
  return cohereClient;
}

/**
 * Given a user's question, find the most relevant knowledge chunks.
 *
 * How it works:
 *   1. Convert the user's question into a vector (1024 numbers)
 *   2. Ask MongoDB Atlas Vector Search: "which stored vectors are closest to this?"
 *   3. Return the top N chunks — these are the most semantically similar facts
 *
 * "Closest" is measured by cosine similarity — two vectors pointing in the
 * same direction in 1024-dimensional space = similar meaning.
 */
async function retrieveRelevantChunks(userMessage, topK = 3) {
  try {
    // Step 1: embed the user's question
    // Note: inputType 'search_query' — must match what we used at seed time
    const queryVector = await embedText(userMessage, 'search_query');

    // Step 2: MongoDB Atlas Vector Search aggregation
    const chunks = await KnowledgeChunk.aggregate([
      {
        $vectorSearch: {
          index: 'knowledge_vector_index',   // name of index you'll create in Atlas UI
          path: 'embedding',                 // field storing the vectors
          queryVector,                       // user's question as a vector
          numCandidates: topK * 10,          // search this many, return top K
          limit: topK,
        },
      },
      {
        // Only return the fields we need — don't send the full 1024-number array back
        $project: { text: 1, source: 1, url: 1, topic: 1, score: { $meta: 'vectorSearchScore' } },
      },
    ]);

    return chunks;
  } catch (err) {
    // If vector search fails (e.g. index not created yet), fail silently
    // SERA still works — just without RAG context
    console.warn('[RAG] Vector search failed, continuing without context:', err.message);
    return [];
  }
}

/**
 * Rerank a pool of chunks against the query with Cohere, keep only those above
 * `minScore`, up to `maxK`. Raising precision without hurting recall, and
 * returning [] for clearly-irrelevant queries (the out-of-scope signal).
 *
 * Fail-safe: if reranking errors (rate limit, network, missing key), fall back
 * to the top `maxK` vector chunks so retrieval never breaks the chat.
 */
async function rerankChunks(query, chunks, { maxK = RERANK_MAX_K, minScore = RERANK_MIN_SCORE } = {}) {
  if (!chunks.length) return [];
  try {
    const res = await getCohere().rerank({
      model: RERANK_MODEL,
      query,
      documents: chunks.map((c) => c.text),
      topN: Math.min(maxK, chunks.length),
    });
    return res.results
      .filter((r) => r.relevanceScore >= minScore)
      .map((r) => ({ ...chunks[r.index], rerankScore: r.relevanceScore }));
  } catch (err) {
    console.warn('[RAG] Rerank failed, falling back to vector top-k:', err.message);
    return chunks.slice(0, maxK);
  }
}

/**
 * Production retrieval: vector over-fetch → Cohere rerank → threshold.
 * This is what routes/ask.js calls. The eval harness calls the same function
 * so tests measure exactly what ships.
 */
async function retrieve(userMessage, { candidates = RERANK_CANDIDATES, maxK = RERANK_MAX_K, minScore = RERANK_MIN_SCORE } = {}) {
  const pool = await retrieveRelevantChunks(userMessage, candidates);
  if (!pool.length) return [];
  return rerankChunks(userMessage, pool, { maxK, minScore });
}

/**
 * Format retrieved chunks into a string to inject into the prompt.
 */
function formatChunksAsContext(chunks) {
  if (!chunks.length) return '';
  const facts = chunks
    .map(c => `- "${c.text}" (${c.source})`)
    .join('\n');
  return `\n\nVerified health information from trusted sources:\n${facts}`;
}

module.exports = { retrieveRelevantChunks, rerankChunks, retrieve, formatChunksAsContext };
