require("dotenv").config();
const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testWhisper() {
  try {
    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream("test-audio.m4a"),
      model: "whisper-1",
    });

    console.log("✅ Whisper transcript:", resp.text);
  } catch (err) {
    console.error("🛑 Whisper error:", err.response?.data || err.message);
  }
}

testWhisper();
