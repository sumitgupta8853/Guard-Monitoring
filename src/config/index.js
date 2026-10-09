require('dotenv').config();
const path = require('path');

const cfg = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/guard-monitor',
  DATA_DIR: path.resolve(process.env.DATA_DIR || './data'),
  UPLOAD_DIR: path.resolve(process.env.UPLOAD_DIR || process.env.DATA_DIR || './data', 'uploads'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  ADMIN_USER: (process.env.ADMIN_USER || 'admin').toLowerCase(),
  ADMIN_PASS: process.env.ADMIN_PASS || 'admin123',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',

  OUTSIDE_READINGS_TO_ALERT: Number(process.env.OUTSIDE_READINGS_TO_ALERT || 2),
  MAX_ACCURACY_M: Number(process.env.MAX_ACCURACY_M || 100),
  // Guards upload a buffered batch every ~15 min, so silence only means
  // "app killed / offline" after 15 min + 5 min grace.
  NO_SIGNAL_AFTER_SEC: Number(process.env.NO_SIGNAL_AFTER_SEC || 1200),
  ESCALATE_AFTER_SEC: Number(process.env.ESCALATE_AFTER_SEC || 300),
  LATE_GRACE_MIN: Number(process.env.LATE_GRACE_MIN || 10),
  MAX_PHOTO_MB: Number(process.env.MAX_PHOTO_MB || 5),
  // Max GPS points accepted in one POST /api/guard/location batch.
  // 15-min cadence x 20 s sampling ~= 45 points; 200 leaves headroom.
  LOCATION_BATCH_MAX: Number(process.env.LOCATION_BATCH_MAX || 200),
  // Expected batch cadence (informational; app-side timer).
  LOCATION_INTERVAL_SEC: Number(process.env.LOCATION_INTERVAL_SEC || 900),
};

if (cfg.JWT_SECRET === 'dev-secret-change-me' || cfg.ADMIN_PASS === 'admin123') {
  console.warn('[WARN] Using default JWT_SECRET / ADMIN_PASS. Set JWT_SECRET and ADMIN_PASS before real use.');
}

module.exports = cfg;
