const express = require('express');
const cfg = require('./config');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': cfg.CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/auth', require('./routes/auth.routes'));
  app.use('/api/admin', require('./routes/admin.routes'));
  app.use('/api/guard', require('./routes/guard.routes'));
  app.use('/api/files', require('./routes/files.routes'));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
