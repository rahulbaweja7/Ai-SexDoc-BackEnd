require("dotenv").config();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testChat() {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Hello from Node" }],
    });
    console.log("✅ Chat success:", response.choices[0].message.content);
  } catch (err) {
    console.error("❌ Chat error:", err?.response?.data || err.message);
  }
}

testChat();
