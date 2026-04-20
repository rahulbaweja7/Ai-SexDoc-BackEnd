/**
 * seedKnowledge.js — run once to populate the RAG knowledge base
 *
 * What this does:
 *   1. Loads curated health facts from data/knowledge.json
 *   2. Sends them to Cohere to get vector embeddings
 *   3. Stores each chunk + its embedding in MongoDB
 *
 * Run with: node scripts/seedKnowledge.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const KnowledgeChunk = require('../utils/models/KnowledgeChunk');
const { embedBatch } = require('../utils/embed');
const knowledgeData = require('../data/knowledge.json');

const BATCH_SIZE = 20; // Cohere allows up to 96, we use 20 to be safe

async function seed() {
  // 1. Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });
  console.log('✅ Connected to MongoDB');

  // 2. Clear existing knowledge chunks (so re-running is safe)
  await KnowledgeChunk.deleteMany({});
  console.log('🗑️  Cleared existing knowledge chunks');

  // 3. Process in batches to avoid API limits
  let totalStored = 0;

  for (let i = 0; i < knowledgeData.length; i += BATCH_SIZE) {
    const batch = knowledgeData.slice(i, i + BATCH_SIZE);
    const texts = batch.map(item => item.text);

    console.log(`\n📤 Embedding batch ${Math.floor(i / BATCH_SIZE) + 1} (${texts.length} chunks)...`);

    // 4. Get embeddings from Cohere — inputType 'search_document' for storage
    const embeddings = await embedBatch(texts, 'search_document');

    // 5. Build MongoDB documents
    const docs = batch.map((item, idx) => ({
      text:      item.text,
      embedding: embeddings[idx],
      source:    item.source,
      url:       item.url || '',
      topic:     item.topic || 'general',
    }));

    // 6. Insert into MongoDB
    await KnowledgeChunk.insertMany(docs);
    totalStored += docs.length;
    console.log(`✅ Stored ${docs.length} chunks (total: ${totalStored})`);
  }

  console.log(`\n🎉 Seeding complete — ${totalStored} chunks stored in MongoDB`);
  console.log('👉 Next step: create the vector search index in MongoDB Atlas UI');
  console.log('   Collection: knowledgechunks | Field: embedding | Dimensions: 1024 | Similarity: cosine');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
