const mongoose = require('mongoose');
const cfg = require('../config');

async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(cfg.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

mongoose.connection.on('error', (err) => console.error('[mongo] error:', err.message));
mongoose.connection.on('disconnected', () => console.warn('[mongo] disconnected'));

async function closeDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, closeDB };
