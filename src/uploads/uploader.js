const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cfg = require('../config');
const { UPLOADS, FOLDERS } = require('./folders');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Files are named <guardId>-<random>.<ext> so access can be limited to the owner.
// folder must be one of the logical folders; anything else is rejected
// so uploads can never escape the UPLOADS directory.
function uploader(folder) {
  if (!folder || typeof folder !== 'string') {
    throw new Error('uploader: folder is required');
  }
  const key = Object.keys(FOLDERS).find(
    (k) => FOLDERS[k].toLowerCase() === String(folder).trim().toLowerCase()
  );
  if (!key) {
    throw new Error(`uploader: unknown folder "${folder}"`);
  }
  const folderName = FOLDERS[key];

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, path.join(UPLOADS, folderName)),
      filename: (req, file, cb) => {
        const owner = req.guard ? req.guard.id : req.params.id;
        cb(null, `${owner}-${crypto.randomBytes(8).toString('hex')}.${EXT[file.mimetype]}`);
      },
    }),
    limits: { fileSize: cfg.MAX_PHOTO_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) =>
      EXT[file.mimetype] ? cb(null, true) : cb(new Error('only jpg, png or webp images are allowed')),
  });
}

// The declared mimetype is client-controlled, so also check the file's magic bytes
function checkImage(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
    const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const png = b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const webp = b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
    return jpg || png || webp;
  } catch {
    return false;
  }
}

const removeFile = (p) => {
  try {
    if (p) fs.unlinkSync(p);
  } catch {
    /* already gone */
  }
};

module.exports = { uploader, checkImage, removeFile };
