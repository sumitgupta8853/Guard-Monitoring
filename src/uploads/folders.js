const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const UPLOADS = path.join(cfg.UPLOAD_DIR, 'uploads');

// Allowed logical folders for uploaded photos. Keep this list in sync
// with the allowed values in the files controller.
const FOLDERS = {
  profiles: 'profiles',
  attendance: 'attendance',
};

for (const folder of Object.values(FOLDERS)) {
  fs.mkdirSync(path.join(UPLOADS, folder), { recursive: true });
}

const ALLOWED_FOLDERS = new Set(Object.values(FOLDERS));

module.exports = { UPLOADS, FOLDERS, ALLOWED_FOLDERS };
