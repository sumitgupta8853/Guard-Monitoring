const { FOLDERS } = require('../uploads/folders');

// Only the logical folders that exist under UPLOADS are served,
// so callers can't build a path outside those directories.
const fileUrl = (folder, name) => {
  const valid = Object.values(FOLDERS).includes(folder);
  return valid && name ? `/api/files/${folder}/${name}` : null;
};

module.exports = { fileUrl };
