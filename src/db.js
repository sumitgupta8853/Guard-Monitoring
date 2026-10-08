// Legacy JSON-file store removed. Use MongoDB via src/db/connect.js + src/models/*.
// This stub keeps old require('./db') calls failing loudly instead of silently.
throw new Error('src/db.js was removed: migrate to MongoDB models (see src/models/*)');

