const push = require('../services/push.service');

// POST /api/push/token — register or refresh this device's FCM token.
// Call after login and on token refresh. Works for guards AND admins
// (role comes from the JWT).
async function register(req, res) {
  const { token, platform, deviceId, appVersion } = req.body || {};
  const row = await push.registerToken(req.user, req.guard, {
    token,
    platform,
    deviceId,
    appVersion,
  });
  res.json({ ok: true, pushEnabled: push.enabled(), device: row });
}

// DELETE /api/push/token — remove token on logout.
async function remove(req, res) {
  const src = { ...(req.query || {}), ...(req.body || {}) };
  const out = await push.removeToken(req.user, {
    token: src.token,
    deviceId: src.deviceId,
  });
  res.json(out);
}

// GET /api/push/status — does this user have registered devices?
async function status(req, res) {
  const rows = await push.tokensForUser(req.user._id || req.user.id);
  res.json({
    ok: true,
    pushEnabled: push.enabled(),
    devices: rows.length,
    platforms: [...new Set(rows.map((r) => r.platform))],
  });
}

// POST /api/push/test — send a test push to this user's devices.
async function test(req, res) {
  const out = await push.sendToUser(req.user._id || req.user.id, {
    title: 'Test notification',
    body: 'Push is working',
    data: { type: 'TEST' },
  });
  res.json(out);
}

module.exports = { register, remove, status, test };