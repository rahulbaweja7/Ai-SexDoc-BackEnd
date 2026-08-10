/**
 * guardrail.js — Phase 4 safety backstop.
 *
 * The keyword emergency check (agent/tools.isEmergency) is fast, free, and
 * deterministic — but brittle: unusual phrasings of a crisis slip through
 * ("i don't want to be here anymore", "i took a whole bottle of pills"). This
 * adds a lightweight LLM classifier as a second layer that catches crisis
 * intent the keywords miss, using a small/fast model so it's cheap enough to
 * run on every message (in parallel with retrieval, so it hides behind that
 * latency).
 *
 * Fail-open: if the classifier errors (rate limit, network), it returns
 * "not emergency" so it can never take the chat down — the keyword layer and
 * normal answering still work.
 */

const { OpenAI } = require('openai');
const { EMERGENCY_REPLY } = require('./tools');

const GUARD_MODEL = process.env.GUARD_MODEL || 'llama-3.1-8b-instant';

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  return client;
}

const SYSTEM = [
  'You are a safety classifier for a sexual-health chatbot.',
  'Decide if the user message signals any of: a medical emergency, self-harm or suicide risk,',
  'or ongoing abuse/violence needing immediate real-world help.',
  'Be sensitive to indirect phrasing (e.g. "i don\'t want to be here anymore" = self_harm).',
  'Do NOT flag ordinary sexual-health questions, mild symptoms, or small talk.',
  'Respond ONLY as JSON: {"emergency": true|false, "type": "medical"|"self_harm"|"abuse"|"none"}.',
].join(' ');

// Type-aware crisis responses — a health bot should route to the right help.
const CRISIS_REPLIES = {
  self_harm:
    "I'm really glad you told me, and I'm concerned about you. Please reach out right now to someone trained to help: " +
    'in the US you can call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 — any time, free and confidential. ' +
    'If you might act on these feelings, call 911 (or 999 in the UK). You are not alone, and you deserve real support right now.',
  abuse:
    "I'm so sorry you're going through this — no one deserves to be hurt, and it's not your fault. " +
    'If you are in immediate danger, call 911 (999 in the UK). You can also reach the National Domestic Violence Hotline at ' +
    '1-800-799-7233, or text START to 88788 — free, confidential, 24/7. This is beyond what I can safely help with, but people who can are ready to help.',
  medical: EMERGENCY_REPLY,
  none: EMERGENCY_REPLY,
};

function getCrisisReply(type) {
  return CRISIS_REPLIES[type] || CRISIS_REPLIES.medical;
}

async function safetyCheck(text) {
  if (!text || !text.trim()) return { emergency: false, type: 'none' };
  try {
    const res = await getClient().chat.completions.create({
      model: GUARD_MODEL,
      temperature: 0,
      max_tokens: 25,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    return { emergency: parsed.emergency === true, type: parsed.type || 'none' };
  } catch (err) {
    // Fail open — never block the chat on a classifier hiccup.
    console.warn('[guardrail] safetyCheck failed, failing open:', err.message);
    return { emergency: false, type: 'none', error: err.message };
  }
}

module.exports = { safetyCheck, getCrisisReply, GUARD_MODEL };
