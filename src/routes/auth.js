const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { sign } = require('../auth');

// Basic brute-force protection: 10 failed logins per 15 min per ip+username
const fails = new Map();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'username and password required' });

  const key = `${req.ip}|${username.toLowerCase()}`;
  const f = fails.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 15 * 60 * 1000) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 10) return res.status(429).json({ error: 'too many attempts, try again later' });

  const user = db.users.find((u) => u.username === username.toLowerCase());
  const guard = user && user.role === 'guard' ? db.guards.find((g) => g.id === user.guardId) : null;
  if (!user || user.disabled || !bcrypt.compareSync(password, user.passwordHash)) {
    f.n++;
    fails.set(key, f);
    return res.status(401).json({ error: 'wrong username or password' });
  }
  if (user.role === 'guard' && (!guard || !guard.active))
    return res.status(403).json({ error: 'account is deactivated' });

  fails.delete(key);
  res.json({ token: sign(user), role: user.role, guardId: user.guardId || null });
});

module.exports = router;
