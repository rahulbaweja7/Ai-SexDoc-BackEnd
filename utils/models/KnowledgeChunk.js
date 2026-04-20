const mongoose = require('mongoose');

// Each document = one chunk of verified health content + its vector embedding
const knowledgeChunkSchema = new mongoose.Schema({
  text:      { type: String,   required: true },   // the actual health fact text
  embedding: { type: [Number], required: true },   // 1024 numbers representing meaning
  source:    { type: String,   required: true },   // "NHS", "Planned Parenthood", "WHO"
  url:       { type: String,   default: '' },      // original article URL if available
  topic:     { type: String,   default: 'general' }, // "contraception", "STIs", "anatomy" etc.
  createdAt: { type: Date,     default: Date.now },
});

module.exports = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
