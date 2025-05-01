const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDatabase = require('./utils/mongodb');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

connectDatabase();

// Routes
const askRoute = require('./routes/ask');
const authRoutes = require('./routes/auth'); // new

app.use('/ask', askRoute);
app.use('/auth', authRoutes); // new

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
