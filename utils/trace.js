/**
 * trace.js — lightweight request tracing + token-cost accounting.
 *
 * recordTrace() is fire-and-forget: it never throws into the request path and
 * never blocks the response (call it after res.end()). If the DB is down, the
 * trace is simply dropped.
 */

const mongoose = require('mongoose');
const Trace = require('./models/Trace');

// Groq pricing per 1M tokens (USD). Estimates — update if pricing changes.
const PRICING = {
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant':    { input: 0.05, output: 0.08 },
};

function costOf(model, promptTokens = 0, completionTokens = 0) {
  const p = PRICING[model] || { input: 0, output: 0 };
  return (promptTokens / 1e6) * p.input + (completionTokens / 1e6) * p.output;
}

function recordTrace(data) {
  // Only try if a DB connection is up; otherwise silently skip.
  if (mongoose.connection.readyState !== 1) return;
  Trace.create(data).catch(() => {});
}

module.exports = { recordTrace, costOf, PRICING };
