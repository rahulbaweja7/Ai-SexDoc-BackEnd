/**
 * fixVectorIndex.js — one-off repair for the MongoDB Atlas vector index.
 *
 * WHY: the existing `knowledge_vector_index` was created with an invalid
 * similarity value ("cosine|dotProduct|euclidean" — the docs placeholder was
 * pasted verbatim), so its build FAILED and $vectorSearch silently returns 0
 * rows. That means SERA has been answering WITHOUT RAG grounding.
 *
 * This script drops the failed index and recreates it correctly
 * (1024 dims, cosine, path=embedding), then polls until it is queryable.
 *
 * Run it yourself (it performs a DB schema change, so agents can't):
 *   node eval/fixVectorIndex.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const KnowledgeChunk = require('../utils/models/KnowledgeChunk');

const INDEX_NAME = 'knowledge_vector_index';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });
  const coll = KnowledgeChunk.collection;

  const before = (await coll.listSearchIndexes().toArray()).find((i) => i.name === INDEX_NAME);
  console.log('Current index:', before ? `${before.name} status=${before.status} queryable=${before.queryable}` : '(none)');

  if (before) {
    console.log('Dropping failed index…');
    try { await coll.dropSearchIndex(INDEX_NAME); } catch (e) { console.log('  drop note:', e.message); }
    await sleep(3000);
  }

  console.log('Creating index (1024d, cosine, path=embedding)…');
  await coll.createSearchIndex({
    name: INDEX_NAME,
    type: 'vectorSearch',
    definition: { fields: [{ type: 'vector', path: 'embedding', numDimensions: 1024, similarity: 'cosine' }] },
  });

  console.log('Polling until queryable (up to ~3 min)…');
  let ready = false;
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const idx = (await coll.listSearchIndexes().toArray()).find((x) => x.name === INDEX_NAME);
    console.log(`  [${(i + 1) * 5}s] status=${idx?.status} queryable=${idx?.queryable}`);
    if (idx?.queryable) { ready = true; break; }
    if (idx?.status === 'FAILED') { console.log('❌ Rebuild FAILED — check the index definition in Atlas.'); break; }
  }

  if (ready) {
    console.log('\n✅ Index is queryable. Now run:  npm run eval:baseline -- --label baseline-grounded');
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
