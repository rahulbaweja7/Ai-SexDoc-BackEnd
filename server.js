const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
dotenv.config();

const connectDatabase = require('./utils/mongodb');
const askRoute = require('./routes/ask');
const authRoute = require('./routes/auth');
const ttsRoute = require('./routes/tts');

const app = express();
const PORT = process.env.PORT || 3001; 

// CORS: support multiple origins via FRONTEND_ORIGINS (comma-separated)
const allowedOrigins = (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173,http://localhost:5500')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production') {
      try {
        const url = new URL(origin);
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (isLocalhost) {
          return callback(null, true);
        }
      } catch (e) {
        // ignore URL parse errors and fall through to rejection
      }
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Removed express-session middleware

// Removed passport initialization

// Connect to MongoDB
connectDatabase();

// Rate limiting — protect Groq API key from abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // 30 messages per minute per IP
  message: { error: 'Slow down — too many messages. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API routes
app.use('/auth', authLimiter, authRoute);
app.use('/ask', chatLimiter, askRoute);
app.use('/chat', chatLimiter, askRoute);

const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many TTS requests, slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/tts', ttsLimiter, ttsRoute);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
