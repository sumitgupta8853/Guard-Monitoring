// Backward-compat shim: both `require('./config')` and `require('./config/index')`
// resolve to the same folder-wise config (now with MONGO_URI / UPLOAD_DIR).
module.exports = require('./config/index');

