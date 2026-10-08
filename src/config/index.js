require('dotenv').config();
const path = require('path');

const cfg = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/guard-monitor',
  DATA_DIR: path.resolve(process.env.DATA_DIR || './data'),
  UPLOAD_DIR: path.resolve(process.env.UPLOAD_DIR || process.env.DATA_DIR || './data', 'uploads'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  ADMIN_USER: (process.env.ADMIN_USER || 'admin').toLowerCase(),
  ADMIN_PASS: process.env.ADMIN_PASS || 'admin123',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',

  OUTSIDE_READINGS_TO_ALERT: Number(process.env.OUTSIDE_READINGS_TO_ALERT || 2),
  MAX_ACCURACY_M: Number(process.env.MAX_ACCURACY_M || 100),
  NO_SIGNAL_AFTER_SEC: Number(process.env.NO_SIGNAL_AFTER_SEC || 120),
  ESCALATE_AFTER_SEC: Number(process.env.ESCALATE_AFTER_SEC || 300),
  LATE_GRACE_MIN: Number(process.env.LATE_GRACE_MIN || 10),
  MAX_PHOTO_MB: Number(process.env.MAX_PHOTO_MB || 5),
};

if (cfg.JWT_SECRET === 'dev-secret-change-me' || cfg.ADMIN_PASS === 'admin123') {
  console.warn('[WARN] Using default JWT_SECRET / ADMIN_PASS. Set JWT_SECRET and ADMIN_PASS before real use.');
}

module.exports = cfg;
