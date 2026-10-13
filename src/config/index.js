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

  // ---- Push notifications (FCM via firebase-admin) ----
  // Get these from Firebase Console -> Project Settings -> Service Accounts.
  // If any is missing, push is disabled but the server + Socket.IO still work.
  PUSH_ENABLED: String(process.env.PUSH_ENABLED || 'true') !== 'false',
  FCM_PROJECT_ID: process.env.FCM_PROJECT_ID || 'guard-monitoring-8dbd2',
  FCM_CLIENT_EMAIL: process.env.FCM_CLIENT_EMAIL || 'firebase-adminsdk-fbsvc@guard-monitoring-8dbd2.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: process.env.FCM_PRIVATE_KEY || '-----BEGIN PRIVATE KEY-----\nMIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQCTvWsHTmkIpFS7\nvEEJfuBycuLgQWc5CMu1AUQuyc58yK9P+L5zLbl5vRD/p5u3chny+b4DlXM5fUmr\nFx0pqFOcCflaPLU7Ktg/k9CBr0wKcGUg5PPHF7HH32ESsvBi4J9+JYZ3qksMUCJq\n3p9OeVC8npGOAQFExR8bWKXrQr/scf/ltoVRaBMWLBqynSC2y0Lck8kesSShmXhU\nbzY/vr3Rxjmoaa/HiMG4PlBVKU1HTskxdWsajwj7rU7mQcuqT31z+iqUxn5pjaAl\n5M7uCPSAB8j7hTYED9d+qGHb4+bbv83B2FRXU4VGh4//9Y090xgOTqVK5rzdeLb7\nAlCxzcO9AgMBAAECgf8HLCsGCzYyx356MRdAXsP0gVY5Q88IPvdbrbQPbOFQUiTD\nBlCB2Ui6Mpgy9cuZihUmJGeC6Zn3nkIZ57w5kqlX6f96PXhF1M6q2ctqNz0MIB+k\nMAulw1wnV/oVXAhPoAXVGf1IrWmJnTXFaC4KoUbcc7HB6gFu55C/no4mcBcqY3Am\nqRXCwvUfEbE+I9FNFjx2P6UgvF+542biNQ2/QPShYn/JHO88871jPt8pB7M7fCCL\nZ/Rvt1M7v1qi+v32PsXXQWRem4Etwh3wwDaSqJ765o/6Yalj6fA3RoOKYs5QDAi3\nI+OoG4K31OqGu/L/pk+PlZTXnkbr8fVeUErvjqECgYEAxDUXmNvcoJ8KCwIbJ7l/\nBe98ReZGD3eBKb2wudHfFj9qsVdUWJCoh087Rn0v0MWRZK7UmtvOxCeNy71Nkayz\n1vocr88m0wpJeDUSblrh7DrUtvBQPdWpvfVfrigdeA60ol+mkdkW1Oh3gIM26G0C\ne2AnT5B0KH+qF2lTfUL62gkCgYEAwMMwIZMwJW3B2i+MgBbOaYfjSXFPF2tQhU9Y\nyeAvV5E7cDXC1GVZU8d5SBq7oEvoAsz6ksEddPL+0JTSre/kyvTekTVzLk4U3rLP\nNpi8DMTA6GeUqn3DYG1XGJhp9nq9aC+GaIQwamW5bxoETCiGj4QtO0l2AeOHh3SJ\nqvw3GRUCgYByKH3hR1L39XDPdNs94rSgTHXe6Zsr1plFIwQXKaAF/sHiCvCdUxVr\nHNNdMOtIKhttHDfBHlEQWf8rYqomLvi4BO/57qolMiALG73sjV5TpusqwWm+gHlx\nd7nCx75VoyDANKziwQ+CsvsMv8uLshk2lXxp059yDM13L6YPBJCVmQKBgQCs/0A2\nEcP3A28j4uKknlM3sOYSJqgF66EDU3frDdFPNJ90kDs/pYmqv+4gASX8scMSqGYF\nyV0ndWGtTrNZuV/LqkIJbj/mAduHFlETvbWffAFpUnTBIkdzRg4Rm9AVjohodaaa\nLHDLPGpUxLOwqfpB2S1C9SX8gfhDYBqhouPMFQKBgFNJHjwe7J7xUiew7hlzJDFJ\n04rYKz10wYsRv1fHrQs33M9Wev9aNG+9a0CP8vlfIffgAkxpK5zIBOfVlfYYbd8K\nLJ0N+tYLPrZqkmOOYQvjWBjYXHcqhAxGlEo15YQxhPW8gBDTqo/HHsrviYgUh7mY\nSmj0GoOg2sW7AB1A6BRr\n-----END PRIVATE KEY-----\n',

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
  // STRICT hourly proof-of-presence: wall-clock top-of-hour slots.
  // The N:00 photo is accepted only inside [N:00 - EARLY, N:00 + LATE],
  // e.g. 10:55-11:05 for the 11:00 photo. Not before, not after.
  HOURLY_EARLY_MIN: Number(process.env.HOURLY_EARLY_MIN ?? 5),
  HOURLY_LATE_MIN: Number(process.env.HOURLY_LATE_MIN ?? 5),
};

if (cfg.JWT_SECRET === 'dev-secret-change-me' || cfg.ADMIN_PASS === 'admin123') {
  console.warn('[WARN] Using default JWT_SECRET / ADMIN_PASS. Set JWT_SECRET and ADMIN_PASS before real use.');
}

module.exports = cfg;