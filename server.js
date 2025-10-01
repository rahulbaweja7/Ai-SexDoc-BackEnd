const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
// Removed session, passport, and auth as signup/login are being removed
const path = require('path');
dotenv.config();

const connectDatabase = require('./utils/mongodb');
const askRoute = require('./routes/ask');
// Removed auth routes import

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

// API routes
app.use('/ask', askRoute);
app.use('/chat', askRoute);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
