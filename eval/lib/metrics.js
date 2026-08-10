/**
 * metrics.js — shared, deterministic scoring helpers for the eval harness.
 * No LLM calls here; the LLM-as-judge metrics live in judge.js.
 */

const fs = require('fs');
const path = require('path');

/** Build a text→chunkId map from corpus.json so retrieved chunks can be identified. */
function loadCorpusIndex() {
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'corpus.json'), 'utf8'));
  const textToId = new Map(corpus.map((c) => [c.text.trim(), c.id]));
  return {
    corpus,
    idFromText: (text) => textToId.get((text || '').trim()) || null,
  };
}

/** Retrieval precision / recall / F1 against golden expected_source_ids. */
function retrievalMetrics(retrievedIds, expectedIds) {
  const exp = new Set(expectedIds);
  const hits = retrievedIds.filter((id) => exp.has(id));
  const precision = retrievedIds.length ? hits.length / retrievedIds.length : 0;
  const recall = exp.size ? hits.length / exp.size : null; // null when nothing expected (out-of-scope)
  let f1;
  if (recall === null) f1 = null;
  else if (precision + recall === 0) f1 = 0;
  else f1 = (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, hitIds: hits };
}

function mean(nums) {
  const vals = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function round(n, d = 4) {
  if (n === null || n === undefined) return n;
  return Math.round(n * 10 ** d) / 10 ** d;
}

function costUsd(usage, pricePerM) {
  return round(
    ((usage?.prompt_tokens || 0) / 1e6) * pricePerM.input +
      ((usage?.completion_tokens || 0) / 1e6) * pricePerM.output,
    6
  );
}

module.exports = { loadCorpusIndex, retrievalMetrics, mean, round, costUsd };
