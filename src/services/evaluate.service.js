// evaluate.js — geofence evaluation for every location ping (Mongo version).
// Supports 15-min buffered batches: each point carries its own client
// timestamp (`atMs`), so violations keep true start/end times even though
// the batch arrives up to 15 min after the guard left the radius.
const cfg = require('../config');
const Location = require('../models/Location.model');
const notify = require('./notify.service');
const monitor = require('./monitor.service');
const { distanceMeters } = require('../utils/geo');

async function evaluate(guard, att, site, { lat, lng, accuracy }, atMs = null) {
  // Client clock wins when sane; server time is the fallback.
  const at = Number.isFinite(atMs) ? new Date(atMs) : new Date();
  const now = new Date();
  const dist = distanceMeters(lat, lng, site.lat, site.lng);
  const d = Math.round(dist);

  // Late / duplicate batch arriving after newer data: keep the breadcrumb
  // but don't let stale points rewind the zone/violation state.
  if (Number.isFinite(att.lastSeenMs) && at.getTime() < att.lastSeenMs - 30000) {
    await Location.create({
      attendanceId: att._id, guardId: guard._id, lat, lng, accuracy,
      distanceMeters: d, time: at.toISOString(),
    });
    const outside = att.zone === 'outside';
    return {
      ok: true, zone: att.zone, distanceMeters: d, radiusMeters: site.radiusMeters,
      stale: true,
      ...(outside && { warning: 'You are outside your assigned area. Return immediately.' }),
    };
  }

  if (!Number.isFinite(att.lastSeenMs) || at.getTime() >= att.lastSeenMs) {
    att.lastSeenAt = at.toISOString();
    att.lastSeenMs = at.getTime();
    att.lastLocation = { lat, lng, accuracy, distanceMeters: d };
  }
  att.signal = 'ok';
  att.noSignalAlerted = false;

  await Location.create({
    attendanceId: att._id, guardId: guard._id, lat, lng, accuracy,
    distanceMeters: d, time: at.toISOString(),
  });

  let ignored = null;
  if (accuracy > cfg.MAX_ACCURACY_M) {
    ignored = 'low accuracy';
  } else if (dist - accuracy > site.radiusMeters) {
    att.outsideCount += 1;
    if (att.outsideCount >= cfg.OUTSIDE_READINGS_TO_ALERT && att.zone !== 'outside') {
      att.zone = 'outside';
      att.violations.push({ startedAt: at.toISOString(), endedAt: null, seconds: 0, maxDistance: d, escalated: false });
      await notify.raiseAlert(guard, 'LEFT_AREA',
        `${guard.name} is ${d}m from "${site.name}" (allowed ${site.radiusMeters}m)`,
        { attendanceId: att._id, distanceMeters: d, lat, lng });
      notify.toGuard(guard._id || guard.id, 'warning', {
        message: `You left your assigned area. Return to "${site.name}" immediately.`, distanceMeters: d,
      });
    }
    const v = monitor.currentViolation(att);
    if (v) {
      v.maxDistance = Math.max(v.maxDistance, d);
      const secs = (at - new Date(v.startedAt)) / 1000;
      if (!v.escalated && secs >= cfg.ESCALATE_AFTER_SEC) {
        v.escalated = true;
        await notify.raiseAlert(guard, 'STILL_OUTSIDE',
          `${guard.name} has been outside "${site.name}" for ${Math.round(secs / 60)} min (now ${d}m away)`,
          { attendanceId: att._id, distanceMeters: d });
      }
    }
  } else {
    att.outsideCount = 0;
    if (att.zone === 'outside') {
      const v = monitor.closeViolation(att, at);
      att.zone = 'inside';
      await notify.raiseAlert(guard, 'RETURNED',
        `${guard.name} is back inside "${site.name}" after ${v ? v.seconds : 0}s`,
        { attendanceId: att._id, distanceMeters: d });
    }
  }

  await att.save();
  notify.toAdmins('guard:update', {
    guardId: guard._id || guard.id, name: guard.name, attendanceId: att._id || att.id, zone: att.zone,
    signal: att.signal, lat, lng, distanceMeters: d, lastSeenAt: att.lastSeenAt,
  });

  const outside = att.zone === 'outside';
  return {
    ok: true, zone: att.zone, distanceMeters: d, radiusMeters: site.radiusMeters,
    ...(ignored && { ignored }),
    ...(outside && { warning: 'You are outside your assigned area. Return immediately.' }),
  };
}

module.exports = { evaluate };
