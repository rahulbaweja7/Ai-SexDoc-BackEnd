// utils/chatWithLLM.js
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function chatWithLLM(promptText, systemPrompt = "You are a friendly and non-judgmental AI sexual health doctor.") {
  const completion = await openai.chat.completions.create({
    model: "gpt-4", 
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptText },
    ],
  });

  return completion.choices[0].message.content;
}

module.exports = { chatWithLLM };
