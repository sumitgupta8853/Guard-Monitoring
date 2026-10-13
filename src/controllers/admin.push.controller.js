const Guard = require('../models/Guard.model');
const push = require('../services/push.service');

// POST /api/admin/push/test — send a test push to yourself (or one guard).
// Body: { title?, body?, guardId? }
async function testPush(req, res) {
  const { title, body, guardId } = req.body || {};
  const payload = {
    title: title || 'Guard Monitor test',
    body: body || 'Push notifications are working.',
    data: { kind: 'test', at: new Date().toISOString() },
  };
  let result;
  if (guardId) {
    const g = await Guard.findById(guardId);
    if (!g) return res.status(404).json({ error: 'guard not found' });
    payload.data.guardId = String(g._id);
    payload.data.guardName = g.name;
    result = await push.sendToGuard(g._id, payload);
  } else {
    result = await push.sendToUser(req.user._id || req.user.id, payload);
  }
  res.json({ ok: true, pushEnabled: push.enabled(), ...payload, result });
}

// POST /api/admin/push/send — announcement to guards.
// Body: { title, body, guardIds?: [id], data? }
async function broadcast(req, res) {
  const { title, body, guardIds, data } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  const payload = { title, body, data: { kind: 'announcement', ...(data || {}) } };
  let result;
  if (Array.isArray(guardIds) && guardIds.length) {
    const per = [];
    for (const gid of guardIds) {
      per.push(await push.sendToGuard(gid, payload));
    }
    const sent = per.reduce((n, r) => n + (r.sent || 0), 0);
    result = { ok: true, sent, details: per };
  } else {
    // No guardIds = all admins get it (guards are targeted explicitly
    // so a stray broadcast never spams every guard's phone at night).
    result = await push.sendToAdmins(payload);
  }
  res.json({ ok: true, pushEnabled: push.enabled(), ...payload, result });
}

module.exports = { testPush, broadcast };
