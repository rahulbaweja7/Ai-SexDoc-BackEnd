const express = require('express');
const router = express.Router();
const { OpenAI } = require("openai");
const jwt = require('jsonwebtoken');
const { retrieve, formatChunksAsContext } = require('../utils/retrieve');
const { isEmergency, isMultiPart, splitParts, factLookup, EMERGENCY_REPLY } = require('../agent/tools');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET; // validated at startup in server.js

// Optional auth — attaches req.user if token present, but does not block unauthenticated requests
// This allows logged-out users to still chat, while logged-in users get their profile injected
function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); } catch {}
  }
  next();
}

let cachedClient = null;
function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is missing. Set it in your .env file.');
  cachedClient = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  return cachedClient;
}

const SYSTEM_PROMPT = `You are SERA — a warm, non-judgmental sexual health guide. Answer like a knowledgeable friend: honest, concise, never preachy. Keep responses short and conversational — 2 to 4 sentences unless the question genuinely needs more detail. Use plain language, no unnecessary lists or headers. If someone seems distressed, acknowledge their feelings first. Topics: sexual health, relationships, contraception, STIs, anatomy, intimacy.`;

function buildProfileContext(profile) {
  if (!profile || !Object.keys(profile).length) return '';
  const parts = [];
  if (profile.name) parts.push(`The user's name is ${profile.name} — use their name naturally occasionally.`);
  if (profile.identity && profile.identity !== 'prefer not to say') parts.push(`They identify as ${profile.identity}.`);
  if (profile.age && profile.age !== 'prefer not to say') parts.push(`They are ${profile.age} years old.`);
  if (profile.topic) parts.push(`They said they're most looking for support with: ${profile.topic}.`);
  return parts.length ? '\n\nUser profile: ' + parts.join(' ') : '';
}

router.post('/', optionalAuth, async (req, res) => {
  const { userMessage, history, profile } = req.body;
  if (!userMessage?.trim()) return res.status(400).json({ error: 'userMessage is required' });

  const startMs = Date.now();
  const userId = req.user?.userId || 'anonymous';

  let openai;
  try {
    openai = getClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const priorMessages = Array.isArray(history)
    ? history.slice(-20).map(m => ({
        role: m.sender === 'You' ? 'user' : 'assistant',
        content: m.content,
      }))
    : [];

  // Stream a ready-made reply (used for the no-LLM decline/emergency routes).
  function streamCanned(route, text) {
    res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    logger.info('/ask:route', { userId, route, latencyMs: Date.now() - startMs });
  }

  try {
    // ── Agent step 1: retrieve (vector + Cohere rerank) ──
    let chunks = await retrieve(userMessage);

    // ── Agent step 2: safety triage (deterministic rule) ──
    // Emergency wording → escalate to real help instead of answering.
    if (isEmergency(userMessage)) return streamCanned('emergency', EMERGENCY_REPLY);

    // ── Agent step 3: decompose multi-part questions (retrieve each part) ──
    if (isMultiPart(userMessage)) {
      const parts = splitParts(userMessage);
      const perPart = await Promise.all(parts.map(p => retrieve(p)));
      const seen = new Set();
      const merged = [];
      for (const list of perPart) for (const c of list) if (!seen.has(c.text)) { seen.add(c.text); merged.push(c); }
      if (merged.length) chunks = merged.slice(0, 4);
    }

    // ── Agent step 4: tool — deterministic structured facts (exact numbers) ──
    const facts = factLookup(userMessage);
    const toolContext = facts.length
      ? `\n\nVerified exact figures (use these numbers precisely):\n${facts.map(f => `- ${f}`).join('\n')}`
      : '';

    const ragContext = formatChunksAsContext(chunks);

    // ── Agent step 5: when there are no grounded facts, let the model handle it
    // conversationally but stay in scope. This covers greetings, casual slang
    // ("wassgood"), and off-topic redirection via understanding, not keyword lists. ──
    const noGrounding = chunks.length === 0;
    const scopeInstruction = noGrounding
      ? "\n\nYou found no verified sources for this particular message. If it is a greeting or small talk, reply warmly and briefly. If it is within your focus (sexual health, relationships, contraception, STIs, anatomy, intimacy, bodies, sexuality), answer helpfully from general knowledge but do NOT invent specific statistics or medical claims. If it is clearly about an unrelated topic (cooking, sports, coding, general trivia, etc.), gently say that is outside what you help with and steer back to your focus. Keep it short and warm."
      : '';

    logger.info('/ask', {
      userId,
      route: noGrounding ? 'answer:no-source' : 'answer',
      ragChunks: chunks.length,
      ragSources: chunks.map(c => c.source),
      toolFacts: facts.length,
      historyLength: priorMessages.length,
      messagePreview: userMessage.slice(0, 60),
    });

    // ── Agent step 6: stream the answer ──
    const stream = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + buildProfileContext(profile) + ragContext + toolContext + scopeInstruction },
        ...priorMessages,
        { role: 'user', content: userMessage },
      ],
    });

    let tokenCount = 0;
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) { res.write(`data: ${JSON.stringify({ token })}\n\n`); tokenCount++; }
    }

    logger.info('/ask:complete', {
      userId,
      latencyMs: Date.now() - startMs,
      tokensStreamed: tokenCount,
      ragChunks: chunks.length,
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    logger.error('/ask', { userId, error: err.message, latencyMs: Date.now() - startMs });
    res.write(`data: ${JSON.stringify({ error: err.message || 'Failed to get AI response' })}\n\n`);
    res.end();
  }
});

module.exports = router;
module.exports.buildProfileContext = buildProfileContext;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
