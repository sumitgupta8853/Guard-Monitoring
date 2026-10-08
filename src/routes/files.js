// Photos are private: admins can open any of the folders, a guard only their own.
const router = require('express').Router();
const path = require('path');
const { UPLOADS, FOLDERS } = require('../db');
const { requireAuth } = require('../auth');

// <img src="/api/files/...?token=JWT"> can't send headers, so allow the token in the query here only
router.use((req, _res, next) => {
  if (!req.get('authorization') && typeof req.query.token === 'string') req.headers.authorization = 'Bearer ' + req.query.token;
  next();
});
router.use(requireAuth('admin', 'guard'));

// Only the logical folders that exist under UPLOADS can be served.
const ALLOWED_FOLDERS = new Set(Object.values(FOLDERS));

router.get('/:folder/:name', (req, res) => {
  const { folder, name } = req.params;
  if (!ALLOWED_FOLDERS.has(folder) || !/^[a-f0-9]{16}-[a-f0-9]{16}\.(jpg|png|webp)$/.test(name)) {
    return res.status(404).json({ error: 'not found' });
  }
  if (req.user.role === 'guard' && name.split('-')[0] !== req.guard.id) {
    return res.status(403).json({ error: 'not allowed' });
  }
  const safePath = path.join(UPLOADS, folder, name);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(safePath, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'not found' }); });
});

module.exports = router;
