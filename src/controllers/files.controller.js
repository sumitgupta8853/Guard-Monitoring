const path = require('path');
const { UPLOADS, ALLOWED_FOLDERS } = require('../uploads/folders');

// Photos are private: admins can open any of the folders, a guard only their own.
// ObjectIds are 24 hex chars: <guardId(24hex)>-<rand(16hex)>.<ext>
const NAME_RE = /^[a-f0-9]{24}-[a-f0-9]{16}\.(jpg|png|webp)$/;

function serveFile(req, res) {
  const { folder, name } = req.params;
  if (!ALLOWED_FOLDERS.has(folder) || !NAME_RE.test(name)) {
    return res.status(404).json({ error: 'not found' });
  }
  if (req.user.role === 'guard' && name.split('-')[0] !== req.guard.id) {
    return res.status(403).json({ error: 'not allowed' });
  }
  const safePath = path.join(UPLOADS, folder, name);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(safePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
  });
}

module.exports = { serveFile };
