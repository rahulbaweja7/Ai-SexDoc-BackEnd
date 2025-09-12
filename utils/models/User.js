const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false }, // Optional for Google OAuth users
  googleId: { type: String, unique: true, sparse: true }, // Google OAuth ID
  name: { type: String },
  picture: { type: String }, // Profile picture URL
  provider: { type: String, enum: ['local', 'google'], default: 'local' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
