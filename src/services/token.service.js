const jwt = require('jsonwebtoken');
const cfg = require('../config');
const User = require('../models/User.model');
const Guard = require('../models/Guard.model');

const sign = (user) =>
  jwt.sign({ uid: user.id || user._id.toString(), role: user.role }, cfg.JWT_SECRET, {
    expiresIn: '12h',
  });

// Returns { user, guard } for a valid token, otherwise null
async function verifyToken(token) {
  try {
    const payload = jwt.verify(token, cfg.JWT_SECRET);
    const user = await User.findById(payload.uid);
    if (!user || user.disabled) return null;
    const guard =
      user.role === 'guard' ? await Guard.findById(user.guardId) : null;
    if (user.role === 'guard' && (!guard || !guard.active)) return null;
    return { user, guard };
  } catch {
    return null;
  }
}

module.exports = { sign, verifyToken };
