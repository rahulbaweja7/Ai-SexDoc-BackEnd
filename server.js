const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const connectDatabase = require('./utils/mongodb');
const askRoute = require('./routes/ask');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT; 

app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDatabase();

// API routes
app.use('/ask', askRoute);
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
