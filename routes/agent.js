const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { runAgent } = require('../agent/graph');

const JWT_SECRET = process.env.JWT_SECRET; // validated at startup in server.js

function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); } catch {}
  }
  next();
}

// POST /agent — run a message through the LangGraph agent (triage → route → answer).
// Non-streaming JSON. The streaming /ask route is unchanged.
router.post('/', optionalAuth, async (req, res) => {
  const { userMessage, history, profile } = req.body;
  if (!userMessage?.trim()) return res.status(400).json({ error: 'userMessage is required' });
  try {
    const r = await runAgent(userMessage, { history, profile });
    res.json({
      route: r.route,
      reply: r.answer,
      sources: r.chunks.map((c) => ({ source: c.source, url: c.url, topic: c.topic })),
      structuredFacts: r.structuredFacts,
      trace: r.trace,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Agent failed' });
  }
});

module.exports = router;
