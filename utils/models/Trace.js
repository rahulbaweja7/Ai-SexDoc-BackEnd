const mongoose = require('mongoose');

// One row per /ask request. PRIVACY: we deliberately do NOT store the user's
// question or the answer text — only routing + performance + cost metadata.
// Rows auto-expire after 30 days (TTL index) so the collection stays bounded.
const traceSchema = new mongoose.Schema({
  route:          { type: String },            // answer | answer:no-source | emergency:* | decline
  model:          { type: String },
  ragChunks:      { type: Number, default: 0 },
  ragSources:     { type: [String], default: [] }, // e.g. ["NHS","Planned Parenthood"]
  toolFacts:      { type: Number, default: 0 },
  guardrailType:  { type: String, default: 'none' }, // medical | self_harm | abuse | none
  promptTokens:   { type: Number, default: 0 },
  completionTokens:{ type: Number, default: 0 },
  costUsd:        { type: Number, default: 0 },
  retrievalMs:    { type: Number, default: 0 },
  generationMs:   { type: Number, default: 0 },
  totalMs:        { type: Number, default: 0 },
  createdAt:      { type: Date, default: Date.now },
});

// TTL: expire documents 30 days after createdAt.
traceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('Trace', traceSchema);
