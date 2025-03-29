const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function chatWithLLM(promptText, systemPrompt = "You are a friendly and non-judgmental AI sexual health doctor.") {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptText },
    ],
  });

  return response.choices[0].message.content;
}

module.exports = { chatWithLLM };
