const { CohereClientV2 } = require('cohere-ai');

let client = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY not set in .env');
  client = new CohereClientV2({ token: apiKey });
  return client;
}

/**
 * Convert a single string into a 1024-dimension vector.
 *
 * WHY input_type matters:
 *   "search_document"  → use when embedding chunks to STORE in the knowledge base
 *   "search_query"     → use when embedding the user's question at query time
 * Cohere trained the model differently for each — using the right type improves accuracy.
 */
async function embedText(text, inputType = 'search_query') {
  const cohere = getClient();
  const response = await cohere.embed({
    texts: [text],
    model: 'embed-english-v3.0',
    inputType,
    embeddingTypes: ['float'],
  });
  return response.embeddings.float[0]; // array of 1024 numbers
}

/**
 * Embed multiple texts in one API call (more efficient for seeding).
 * Cohere allows up to 96 texts per request.
 */
async function embedBatch(texts, inputType = 'search_document') {
  const cohere = getClient();
  const response = await cohere.embed({
    texts,
    model: 'embed-english-v3.0',
    inputType,
    embeddingTypes: ['float'],
  });
  return response.embeddings.float; // array of arrays
}

module.exports = { embedText, embedBatch };
