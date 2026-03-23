const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../utils/models/User');

const router = express.Router();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '829177934485-qsa66r4mnv6rdu6sho38pfmf1h51grju.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// POST /auth/google
// Receives a Google credential (ID token), verifies it, finds or creates user, returns JWT
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ message: 'Missing credential' });

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, email, name, picture } = ticket.getPayload();

    // Find or create user
    let user = await User.findOne({ googleId });
    if (!user) {
      user = await User.findOne({ email });
      if (user) {
        // Link Google to existing account
        user.googleId = googleId;
        user.provider = 'google';
        if (!user.picture) user.picture = picture;
        await user.save();
      } else {
        user = await User.create({ email, name, picture, googleId, provider: 'google' });
      }
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[Auth] Google verification failed:', err.message, err.stack);
    res.status(401).json({ message: err.message || 'Invalid Google credential' });
  }
});

// GET /auth/me  — verify JWT and return current user
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'No token' });
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: { id: user._id, email: user.email, name: user.name, picture: user.picture, role: user.role } });
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
});

module.exports = router;
