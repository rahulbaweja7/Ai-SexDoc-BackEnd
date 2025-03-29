const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  sessionId: String,
  userId: String,
  transcript: String,
  reply: String,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Conversation', conversationSchema);
