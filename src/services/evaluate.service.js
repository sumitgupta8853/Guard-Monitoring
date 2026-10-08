// evaluate.js — geofence evaluation for every location ping (Mongo version).
const cfg = require('../config');
const Location = require('../models/Location.model');
const notify = require('./notify.service');
const monitor = require('./monitor.service');
const { distanceMeters } = require('../utils/geo');

async function evaluate(guard, att, site, { lat, lng, accuracy }) {
  const now = new Date();
  const dist = distanceMeters(lat, lng, site.lat, site.lng);
  const d = Math.round(dist);

  att.lastSeenAt = now.toISOString();
  att.lastSeenMs = now.getTime();
  att.lastLocation = { lat, lng, accuracy, distanceMeters: d };
  att.signal = 'ok';
  att.noSignalAlerted = false;

  await Location.create({
    attendanceId: att._id, guardId: guard._id, lat, lng, accuracy,
    distanceMeters: d, time: att.lastSeenAt,
  });

  let ignored = null;
  if (accuracy > cfg.MAX_ACCURACY_M) {
    ignored = 'low accuracy';
  } else if (dist - accuracy > site.radiusMeters) {
    att.outsideCount += 1;
    if (att.outsideCount >= cfg.OUTSIDE_READINGS_TO_ALERT && att.zone !== 'outside') {
      att.zone = 'outside';
      att.violations.push({ startedAt: att.lastSeenAt, endedAt: null, seconds: 0, maxDistance: d, escalated: false });
      await notify.raiseAlert(guard, 'LEFT_AREA',
        `${guard.name} is ${d}m from "${site.name}" (allowed ${site.radiusMeters}m)`,
        { attendanceId: att._id, distanceMeters: d, lat, lng });
      notify.toGuard(guard.id, 'warning', {
        message: `You left your assigned area. Return to "${site.name}" immediately.`, distanceMeters: d,
      });
    }
    const v = monitor.currentViolation(att);
    if (v) {
      v.maxDistance = Math.max(v.maxDistance, d);
      const secs = (now - new Date(v.startedAt)) / 1000;
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
      const v = monitor.closeViolation(att, now);
      att.zone = 'inside';
      await notify.raiseAlert(guard, 'RETURNED',
        `${guard.name} is back inside "${site.name}" after ${v ? v.seconds : 0}s`,
        { attendanceId: att._id, distanceMeters: d });
    }
  }

  await att.save();
  notify.toAdmins('guard:update', {
    guardId: guard.id, name: guard.name, attendanceId: att.id, zone: att.zone,
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
