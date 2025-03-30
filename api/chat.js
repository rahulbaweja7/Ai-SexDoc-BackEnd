// api/chat.js
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
require("dotenv").config();

const { transcribeAudio } = require("../utils/transcribeAudio");
const { chatWithLLM } = require("../utils/chatWithLLM");
const connectToMongo = require("../utils/mongodb");
const Conversation = require("../utils/models/Conversation");

const app = express();
app.use(cors());
app.use(express.json());

// File upload setup
const upload = multer({ dest: "uploads/" });

// Connect to MongoDB
connectToMongo();

app.post("/api/chat", upload.single("audio"), async (req, res) => {
  try {
    const metadata = JSON.parse(req.body.metadata);
    const audioFile = req.file;

    if (!audioFile || !metadata) {
      return res.status(400).json({ error: "Missing audio or metadata" });
    }

    // 1. Transcribe audio
    const transcript = await transcribeAudio(audioFile.path);

    // 2. Get LLM response
    const reply = await chatWithLLM(transcript);

    // 3. Store conversation using Mongoose model
    await Conversation.create({
      sessionId: metadata.sessionId,
      userId: metadata.userId,
      transcript,
      reply,
      timestamp: new Date(),
    });

    // 4. Clean up temp file
    fs.unlink(audioFile.path, () => {});

    // 5. Send response
    res.json({
      success: true,
      reply,
      transcript,
    });
  } catch (err) {
    console.error("🔥 Error in /api/chat:", err.stack || err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Only run if executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
