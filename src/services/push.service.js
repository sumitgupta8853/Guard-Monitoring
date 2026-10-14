// push.service.js — Firebase Cloud Messaging (FCM) via firebase-admin.
// Lazy init, never crashes when keys are missing. If PUSH is not
// configured, send* calls resolve { ok:false, disabled:true } so
// Socket.IO alerts + webhooks keep working and tests still pass.
const cfg = require('../config');
const DeviceToken = require('../models/DeviceToken.model');
const User = require('../models/User.model');

let fbApp = null;
let initError = null;
let loggedState = false;

function isConfigured() {
  return !!(cfg.FCM_PROJECT_ID && cfg.FCM_CLIENT_EMAIL && cfg.FCM_PRIVATE_KEY);
}

function messaging() {
  if (!isConfigured()) {
    if (!loggedState) {
      loggedState = true;
      console.log('[PUSH] disabled — set FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY to enable');
    }
    return null;
  }
  try {
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    if (!fbApp) {
      const privateKey = String(cfg.FCM_PRIVATE_KEY).replace(/\\n/g, '\n');
      fbApp = getApps().length
        ? getApps()[0]
        : initializeApp({
          credential: cert({
            projectId: cfg.FCM_PROJECT_ID,
            clientEmail: cfg.FCM_CLIENT_EMAIL,
            privateKey,
          }),
        });
      if (!loggedState) {
        loggedState = true;
        console.log(`[PUSH] enabled for Firebase project "${cfg.FCM_PROJECT_ID}"`);
      }
    }
    return getMessaging(fbApp);
  } catch (e) {
    if (!initError || initError !== e.message) {
      initError = e.message;
      console.error('[PUSH] init failed:', e.message);

    }
    return null;
  }
}


function enabled() {
  return isConfigured();
}

async function registerToken(user, guard, { token, platform, deviceId, appVersion }) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    const err = new Error('valid FCM token is required');
    err.status = 400;
    throw err;
  }
  const p = (platform || 'android').toLowerCase();
  if (!['android', 'ios', 'web'].includes(p)) {
    const err = new Error('platform must be android, ios or web');
    err.status = 400;
    throw err;
  }

  // fallback: find the guard record if the middleware didn't attach it
  if (!guard && user.role === 'guard') {
    const Guard = require('../models/Guard.model');
    guard = await Guard.findOne({ userId: user._id || user.id });
  }

  const now = new Date().toISOString();
  const base = {
    userId: user._id || user.id,
    guardId: guard ? guard._id || guard.id : null,
    role: user.role,
    platform: p,
    deviceId: deviceId || null,
    appVersion: appVersion || null,
    lastRegisteredAt: now,
  };

  if (deviceId) {
    // free this token from any other row first (unique index on token)
    await DeviceToken.deleteMany({ token, $nor: [{ userId: base.userId, deviceId }] });
    const row = await DeviceToken.findOneAndUpdate(
      { userId: base.userId, deviceId },
      { $set: { ...base, token } },
      { new: true, upsert: true }
    );
    return row.toJSON();
  }

  const row = await DeviceToken.findOneAndUpdate(
    { token },
    { $set: base },
    { new: true, upsert: true }
  );
  return row.toJSON();
}

async function removeToken(user, { token, deviceId }) {
  const q = { userId: user._id || user.id };
  if (token) q.token = token;
  else if (deviceId) q.deviceId = deviceId;
  else {
    const err = new Error('token or deviceId is required');
    err.status = 400;
    throw err;
  }
  const r = await DeviceToken.deleteMany(q);
  return { ok: true, removed: r.deletedCount || 0 };
}

// ---- token lookups + sending ----

async function tokensForUser(userId) {
  return DeviceToken.find({ userId }).select('token platform').lean();
}

async function tokensForGuard(guardId) {
  return DeviceToken.find({ guardId }).select('token platform').lean();
}

async function tokensForAdmins() {
  const admins = await User.find({ role: 'admin', disabled: { $ne: true } }).select('_id');
  if (!admins.length) return [];
  const ids = admins.map((a) => a._id);
  return DeviceToken.find({ userId: { $in: ids } }).select('token platform').lean();
}

async function deleteTokens(tokens) {
  if (!tokens || !tokens.length) return;
  await DeviceToken.deleteMany({ token: { $in: tokens } });
}

function invalidTokenError(e) {
  const code = (e && (e.code || (e.errorInfo && e.errorInfo.code))) || '';
  return (
    code.includes('registration-token-not-registered') ||
    code.includes('invalid-registration-token')
  );
}

async function sendMulticast(tokens, { title, body, data }) {
  const m = messaging();
  if (!m) return { ok: false, disabled: true, sent: 0 };
  if (!tokens.length) return { ok: true, sent: 0, note: 'no devices registered' };
  let sent = 0;
  let failed = 0;
  const stale = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500).map((t) => (typeof t === 'string' ? t : t.token));
    try {
      const resp = await m.sendEachForMulticast({
        tokens: batch,
        notification: { title: title || 'Guard Monitor', body: body || '' },
        data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v == null ? '' : v)])),
        android: {
          priority: 'high',
          ttl: 3600 * 1000,
          notification: { sound: 'default', channelId: 'alerts' },
        },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      });
      sent += resp.successCount;
      failed += resp.failureCount;
      resp.responses.forEach((r, idx) => {
        if (!r.success && r.error) {
          console.error('[PUSH] token failed:', r.error.code, '-', r.error.message);
          if (invalidTokenError(r.error)) stale.push(batch[idx]);
        }
      });
    } catch (e) {
      failed += batch.length;
      console.error('[PUSH] send failed:', e.message);
    }
  }
  if (stale.length) {
    await deleteTokens(stale).catch(() => { });
    console.log(`[PUSH] removed ${stale.length} stale device token(s)`);
  }
  return { ok: true, sent, failed };
}

const sendToUser = (userId, payload) =>
  tokensForUser(userId).then((rows) => sendMulticast(rows, payload));

const sendToGuard = (guardId, payload) =>
  tokensForGuard(guardId).then((rows) => sendMulticast(rows, payload));

const sendToAdmins = (payload) =>
  tokensForAdmins().then((rows) => sendMulticast(rows, payload));

// Called by notify.raiseAlert — fire-and-forget, never throws.
async function pushAlert({ title, body, data, toGuardId, toAdmins }) {
  try {
    const jobs = [];
    if (toAdmins) jobs.push(sendToAdmins({ title, body, data }));
    if (toGuardId) jobs.push(sendToGuard(toGuardId, { title, body, data }));
    const out = await Promise.all(jobs);
    if (out.some((r) => r && r.sent)) {
      console.log(`[PUSH] ${data && data.type ? data.type : 'alert'} -> sent`);
    }
    return out;
  } catch (e) {
    console.error('[PUSH] pushAlert failed:', e.message);
    return [];
  }
}

function pushGuardWarning(guardId, title, body, data) {
  pushAlert({ title, body, data: data || {}, toGuardId: guardId, toAdmins: false });
}

module.exports = {
  enabled,
  isConfigured,
  messaging,
  registerToken,
  removeToken,
  tokensForUser,
  tokensForGuard,
  tokensForAdmins,
  sendToUser,
  sendToGuard,
  sendToAdmins,
  pushAlert,
  pushGuardWarning,
};