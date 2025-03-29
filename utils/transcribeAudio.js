// utils/transcribeAudio.js
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAudio(filePath) {
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(path.resolve(filePath)),
    model: "whisper-1",
  });
  return response.text;
}

module.exports = { transcribeAudio };
