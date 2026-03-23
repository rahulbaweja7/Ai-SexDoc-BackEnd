const express = require('express');
const router = express.Router();
const { OpenAI } = require("openai");

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

router.post('/', async (req, res) => {
  const { userMessage, history, profile } = req.body;
  if (!userMessage?.trim()) return res.status(400).json({ error: 'userMessage is required' });

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

  // Build messages: system + prior conversation + current message
  const priorMessages = Array.isArray(history)
    ? history.slice(-20).map(m => ({          // cap at last 20 to avoid token limits
        role: m.sender === 'You' ? 'user' : 'assistant',
        content: m.content,
      }))
    : [];

  try {
    const stream = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + buildProfileContext(profile) },
        ...priorMessages,
        { role: 'user', content: userMessage },
      ],
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Error in /ask:', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Failed to get AI response' })}\n\n`);
    res.end();
  }
});

module.exports = router;
