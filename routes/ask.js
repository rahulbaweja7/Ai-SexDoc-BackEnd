const express = require('express');
const router = express.Router();
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', async (req, res) => {
  const { userMessage } = req.body;

  if (!userMessage || userMessage.trim() === '') {
    return res.status(400).json({ error: 'userMessage is required' });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a respectful and helpful AI sexual health doctor." },
        { role: "user", content: userMessage }
      ],
    });

    const replyFromAi = response.choices[0].message.content;

    return res.json({ aiResponse: replyFromAi });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to get AI response' });
  }
});

module.exports = router;
