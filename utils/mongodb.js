const mongoose = require('mongoose');
require('dotenv').config();

async function connectToMongo() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    const mongoDbName = process.env.MONGODB_DB;

    if (!mongoUri) {
      console.warn('⚠️  MONGODB_URI not set; starting server without a database connection');
      return;
    }

    const options = {};
    if (mongoDbName) {
      options.dbName = mongoDbName;
    }

    await mongoose.connect(mongoUri, options);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    console.warn('⚠️  Continuing to run without a database connection');
  }
}

module.exports = connectToMongo;
