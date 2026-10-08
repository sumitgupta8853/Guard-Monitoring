const jwt = require('jsonwebtoken');
const cfg = require('./config');
const { db } = require('./db');

const sign = (user) =>
  jwt.sign({ uid: user.id, role: user.role }, cfg.JWT_SECRET, { expiresIn: '12h' });

// Returns { user, guard } for a valid token, otherwise null
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, cfg.JWT_SECRET);
    const user = db.users.find((u) => u.id === payload.uid);
    if (!user || user.disabled) return null;
    const guard = user.role === 'guard' ? db.guards.find((g) => g.id === user.guardId) : null;
    if (user.role === 'guard' && (!guard || !guard.active)) return null;
    return { user, guard };
  } catch {
    return null;
  }
}

const requireAuth = (...roles) => (req, res, next) => {
  const h = req.get('authorization') || '';
  const auth = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!auth) return res.status(401).json({ error: 'login required' });
  if (roles.length && !roles.includes(auth.user.role)) return res.status(403).json({ error: 'not allowed' });
  req.user = auth.user;
  req.guard = auth.guard;
  next();
};

module.exports = { sign, verifyToken, requireAuth };
