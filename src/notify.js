const { db, save, id } = require('./db');
const cfg = require('./config');

let io = null;
const init = (instance) => { io = instance; };
const toAdmins = (event, payload) => io && io.to('admins').emit(event, payload);
const toGuard = (guardId, event, payload) => io && io.to('guard:' + guardId).emit(event, payload);

function raiseAlert(guard, type, message, extra = {}) {
  const alert = {
    id: id(), guardId: guard.id, guardName: guard.name, siteId: guard.siteId,
    type, message, time: new Date().toISOString(), acknowledged: false, ...extra,
  };
  db.alerts.push(alert);
  if (db.alerts.length > 5000) db.alerts.splice(0, 1000);
  save();
  toAdmins('alert', alert);
  console.log(`[ALERT] ${type}: ${message}`);
  if (cfg.WEBHOOK_URL) {
    fetch(cfg.WEBHOOK_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(alert),
    }).catch((e) => console.error('webhook failed:', e.message));
  }
  return alert;
}

module.exports = { init, toAdmins, toGuard, raiseAlert };
