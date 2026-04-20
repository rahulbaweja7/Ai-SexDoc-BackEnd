const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'sera_jwt_secret_change_before_deploy';

function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); } catch {}
  }
  next();
}

const feedbackSchema = new mongoose.Schema({
  rating:     { type: String, enum: ['up', 'down'], required: true },
  message:    { type: String },          // the SERA response that was rated
  userMessage:{ type: String },          // what the user asked
  ragChunks:  { type: [String] },        // which chunks were retrieved (sources)
  userId:     { type: String },          // null for anonymous
  sessionId:  { type: String },
  createdAt:  { type: Date, default: Date.now },
});

const Feedback = mongoose.model('Feedback', feedbackSchema);

// POST /feedback — store a rating on a SERA response
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { rating, message, userMessage, ragChunks, sessionId } = req.body;
    if (!rating) return res.status(400).json({ error: 'rating required' });

    await Feedback.create({
      rating,
      message:     message?.slice(0, 500),
      userMessage: userMessage?.slice(0, 200),
      ragChunks:   ragChunks || [],
      userId:      req.user?.userId || null,
      sessionId:   sessionId || null,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /feedback/summary — basic stats (how many up vs down)
router.get('/summary', async (req, res) => {
  try {
    const [up, down] = await Promise.all([
      Feedback.countDocuments({ rating: 'up' }),
      Feedback.countDocuments({ rating: 'down' }),
    ]);
    const total = up + down;
    res.json({ up, down, total, satisfactionRate: total ? Math.round((up / total) * 100) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
