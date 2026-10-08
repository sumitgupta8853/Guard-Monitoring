const cfg = require('../config');
const Alert = require('../models/Alert.model');

let io = null;
const init = (instance) => {
  io = instance;
};
const toAdmins = (event, payload) => io && io.to('admins').emit(event, payload);
const toGuard = (guardId, event, payload) => io && io.to('guard:' + guardId).emit(event, payload);

async function raiseAlert(guard, type, message, extra = {}) {
  const alert = await Alert.create({
    guardId: guard._id || guard.id,
    guardName: guard.name,
    siteId: guard.siteId || null,
    type,
    message,
    time: new Date().toISOString(),
    acknowledged: false,
    attendanceId: extra.attendanceId || null,
    distanceMeters: extra.distanceMeters ?? null,
    lat: extra.lat ?? null,
    lng: extra.lng ?? null,
  });
  // cap collection: keep newest ~5000
  const count = await Alert.countDocuments();
  if (count > 5000) {
    const old = await Alert.find().sort({ time: 1 }).limit(count - 5000).select('_id');
    await Alert.deleteMany({ _id: { $in: old.map((a) => a._id) } });
  }
  toAdmins('alert', alert.toJSON());
  console.log(`[ALERT] ${type}: ${message}`);
  if (cfg.WEBHOOK_URL) {
    fetch(cfg.WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alert.toJSON()),
    }).catch((e) => console.error('webhook failed:', e.message));
  }
  return alert;
}

module.exports = { init, toAdmins, toGuard, raiseAlert };
