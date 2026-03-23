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

const SYSTEM_PROMPT = `You are SERA — a warm, non-judgmental, and knowledgeable sexual health guide. You give honest, research-informed answers about sexual health, relationships, contraception, STIs, anatomy, and intimacy. You speak like a trusted, well-informed friend — never clinical or cold, never preachy or judgmental. Keep responses focused and conversational. If someone seems distressed, acknowledge their feelings before giving information.`;

router.post('/', async (req, res) => {
  const { userMessage } = req.body;
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

  try {
    const stream = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
