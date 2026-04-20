const mongoose = require('mongoose');
const KnowledgeChunk = require('./models/KnowledgeChunk');
const { embedText } = require('./embed');

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
 * Format retrieved chunks into a string to inject into the prompt.
 */
function formatChunksAsContext(chunks) {
  if (!chunks.length) return '';
  const facts = chunks
    .map(c => `- "${c.text}" (${c.source})`)
    .join('\n');
  return `\n\nVerified health information from trusted sources:\n${facts}`;
}

module.exports = { retrieveRelevantChunks, formatChunksAsContext };
