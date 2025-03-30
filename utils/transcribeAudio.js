const fs = require("fs");
const path = require("path");
const { extname } = require("path");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAudio(filePath) {
  try {
    const ext = extname(filePath) || ".m4a"; // fallback if extension is missing
    const renamedPath = `${filePath}${ext}`;

    // Temporarily rename the file for Whisper
    fs.renameSync(filePath, renamedPath);

    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(renamedPath),
      model: "whisper-1",
    });

    // Clean up the renamed file
    fs.unlinkSync(renamedPath);

    return response.text;
  } catch (err) {
    console.error("🛑 Whisper API Error:", err.response?.data || err.message);
    throw new Error("Connection error.");
  }
}

module.exports = { transcribeAudio };
