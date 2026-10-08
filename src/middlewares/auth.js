const { verifyToken } = require('../services/token.service');

const requireAuth = (...roles) => async (req, res, next) => {
  try {
    const h = req.get('authorization') || '';
    const auth = await verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!auth) return res.status(401).json({ error: 'login required' });
    if (roles.length && !roles.includes(auth.user.role))
      return res.status(403).json({ error: 'not allowed' });
    req.user = auth.user;
    req.guard = auth.guard;
    next();
  } catch (e) {
    next(e);
  }
};

module.exports = { requireAuth };
