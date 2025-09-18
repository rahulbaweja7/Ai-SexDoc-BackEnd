const express = require('express');
const router = express.Router();
const { OpenAI } = require("openai");

let cachedOpenAIClient = null;
function getOpenAIClient() {
  if (cachedOpenAIClient) return cachedOpenAIClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing. Set it in your environment or .env file.');
  }
  cachedOpenAIClient = new OpenAI({ apiKey });
  return cachedOpenAIClient;
}

router.post('/', async (req, res) => {
  const { userMessage } = req.body;

  if (!userMessage || userMessage.trim() === '') {
    return res.status(400).json({ error: 'userMessage is required' });
  }

  try {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a respectful and helpful AI sexual health doctor." },
        { role: "user", content: userMessage }
      ],
    });

    const replyFromAi = response.choices[0].message.content;

    return res.json({ reply: replyFromAi });


  } catch (error) {
    console.error('There was an error in the /ask route.', error);
    const message = error && error.message ? error.message : 'Failed to get AI response';
    const status = message.includes('OPENAI_API_KEY') ? 500 : 500;
    return res.status(status).json({ error: message });
  }
});

module.exports = router;
