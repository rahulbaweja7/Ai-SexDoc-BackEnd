/**
 * retrievers.js — pluggable retrieval strategies for Phase 2 experiments.
 *
 * Each strategy takes (query, opts) and returns an array of chunks shaped like
 * the current pipeline's output ({ text, source, url, topic, score, ... }), so
 * the eval runner and prompt builder don't care which strategy produced them.
 *
 * Strategies:
 *   - vector : current baseline — pure Atlas vector search, fixed topK.
 *   - rerank : over-fetch by vector, then Cohere rerank, keep chunks above a
 *              relevance threshold (dynamic k), capped at maxK. This is what
 *              raises precision and lets clearly-irrelevant queries return [].
 */

// Use the SAME implementations that ship in production, so eval measures what runs.
const { retrieveRelevantChunks, retrieve } = require('../utils/retrieve');

async function vector(query, { topK = 3 } = {}) {
  return retrieveRelevantChunks(query, topK);
}

/**
 * Production rerank path: vector over-fetch → Cohere rerank → threshold.
 * Delegates to utils/retrieve.retrieve so this is exactly what the live app does.
 */
async function rerank(query, { candidates = 10, maxK = 3, minScore = 0.3 } = {}) {
  return retrieve(query, { candidates, maxK, minScore });
}

const STRATEGIES = { vector, rerank };

/** Dispatch by name; unknown names throw so typos fail loudly. */
function getRetriever(name) {
  const fn = STRATEGIES[name];
  if (!fn) throw new Error(`Unknown retriever "${name}". Options: ${Object.keys(STRATEGIES).join(', ')}`);
  return fn;
}

module.exports = { getRetriever, STRATEGIES };
