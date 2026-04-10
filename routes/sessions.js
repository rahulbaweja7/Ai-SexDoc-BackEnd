const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Session = require('../utils/models/Session');

const JWT_SECRET = process.env.JWT_SECRET || 'sera_jwt_secret_change_before_deploy';

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /sessions — list all sessions for the user (title + metadata, no messages)
router.get('/', requireAuth, async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.userId })
      .select('title createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions — create a new session
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    const session = await Session.create({ userId: req.user.userId, title: title || 'New chat' });
    res.json({ id: session._id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sessions/:id — get a session with all its messages
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sessions/:id — rename a session
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { title, updatedAt: Date.now() },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json({ id: session._id, title: session.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sessions/:id — delete a session
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await Session.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions/:id/messages — add a message to a session
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const { sender, content } = req.body;
    if (!sender || !content) return res.status(400).json({ error: 'sender and content required' });

    const session = await Session.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!session) return res.status(404).json({ error: 'Not found' });

    session.messages.push({ sender, content });
    session.updatedAt = Date.now();
    // Auto-title from first user message
    if (session.title === 'New chat' && sender === 'You') {
      session.title = content.slice(0, 60);
    }
    await session.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions/:id/messages/bulk — save multiple messages at once (end of conversation)
router.post('/:id/messages/bulk', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    const session = await Session.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!session) return res.status(404).json({ error: 'Not found' });

    session.messages = messages.map(m => ({ sender: m.sender, content: m.content }));
    session.updatedAt = Date.now();
    const firstUser = messages.find(m => m.sender === 'You');
    if (session.title === 'New chat' && firstUser) {
      session.title = firstUser.content.slice(0, 60);
    }
    await session.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
