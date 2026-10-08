// Core rules: attendance state, geofence evaluation, violations, watchdog.
const { db, save, id } = require('./db');
const cfg = require('./config');
const notify = require('./notify');
const { distanceMeters, localDate, toMinutes } = require('./util');

const openAttendance = (guardId) => db.attendance.find((a) => a.guardId === guardId && !a.checkOutAt);
const siteOf = (guard) => db.sites.find((s) => s.id === guard.siteId);
const currentViolation = (att) => att.violations.find((v) => !v.endedAt);

function closeViolation(att, at = new Date()) {
  const v = currentViolation(att);
  if (!v) return null;
  v.endedAt = at.toISOString();
  v.seconds = Math.round((at - new Date(v.startedAt)) / 1000);
  att.outsideSeconds += v.seconds;
  return v;
}

// Called for every location ping while the guard has an open attendance
function evaluate(guard, att, site, { lat, lng, accuracy }) {
  const now = new Date();
  const dist = distanceMeters(lat, lng, site.lat, site.lng);
  const d = Math.round(dist);

  att.lastSeenAt = now.toISOString();
  att.lastSeenMs = now.getTime();
  att.lastLocation = { lat, lng, accuracy, distanceMeters: d };
  att.signal = 'ok';
  att.noSignalAlerted = false;

  db.locations.push({ attendanceId: att.id, guardId: guard.id, lat, lng, accuracy, distanceMeters: d, time: att.lastSeenAt });
  if (db.locations.length > 50000) db.locations.splice(0, 10000);

  let ignored = null;
  if (accuracy > cfg.MAX_ACCURACY_M) {
    ignored = 'low accuracy';
  } else if (dist - accuracy > site.radiusMeters) {
    // outside only if the whole GPS accuracy circle is beyond the radius
    att.outsideCount++;
    if (att.outsideCount >= cfg.OUTSIDE_READINGS_TO_ALERT && att.zone !== 'outside') {
      att.zone = 'outside';
      att.violations.push({ id: id(), startedAt: att.lastSeenAt, endedAt: null, seconds: 0, maxDistance: d, escalated: false });
      notify.raiseAlert(guard, 'LEFT_AREA',
        `${guard.name} is ${d}m from "${site.name}" (allowed ${site.radiusMeters}m)`,
        { attendanceId: att.id, distanceMeters: d, lat, lng });
      notify.toGuard(guard.id, 'warning', {
        message: `You left your assigned area. Return to "${site.name}" immediately.`, distanceMeters: d,
      });
    }
    const v = currentViolation(att); 
    if (v) {
      v.maxDistance = Math.max(v.maxDistance, d);
      const secs = (now - new Date(v.startedAt)) / 1000;
      if (!v.escalated && secs >= cfg.ESCALATE_AFTER_SEC) {
        v.escalated = true;
        notify.raiseAlert(guard, 'STILL_OUTSIDE',
          `${guard.name} has been outside "${site.name}" for ${Math.round(secs / 60)} min (now ${d}m away)`,
          { attendanceId: att.id, distanceMeters: d });
      }
    }
  } else {
    att.outsideCount = 0;
    if (att.zone === 'outside') {
      const v = closeViolation(att, now);
      att.zone = 'inside';
      notify.raiseAlert(guard, 'RETURNED',
        `${guard.name} is back inside "${site.name}" after ${v ? v.seconds : 0}s`,
        { attendanceId: att.id, distanceMeters: d });
    }
  }

  save();
  notify.toAdmins('guard:update', {
    guardId: guard.id, name: guard.name, attendanceId: att.id, zone: att.zone, signal: att.signal,
    lat, lng, distanceMeters: d, lastSeenAt: att.lastSeenAt,
  });

  const outside = att.zone === 'outside';
  return {
    ok: true, zone: att.zone, distanceMeters: d, radiusMeters: site.radiusMeters,
    ...(ignored && { ignored }),
    ...(outside && { warning: 'You are outside your assigned area. Return immediately.' }),
  };
}

function closeAttendance(att, { by, photo = null, location = null }) {
  const now = new Date();
  closeViolation(att, now);
  att.checkOutAt = now.toISOString();
  att.checkOutPhoto = photo;
  att.checkOutLocation = location;
  att.closedBy = by;
  att.workedSeconds = Math.round((now - new Date(att.checkInAt)) / 1000);
  att.insideSeconds = Math.max(0, att.workedSeconds - att.outsideSeconds);
  save();
  return att;
}

function tick() {
  const nowMs = Date.now();

  // 1) Guards on duty who stopped reporting (phone off, GPS disabled, app killed)
  for (const att of db.attendance) {
    if (att.checkOutAt || att.signal === 'lost') continue;
    if (nowMs - att.lastSeenMs > cfg.NO_SIGNAL_AFTER_SEC * 1000) {
      const guard = db.guards.find((g) => g.id === att.guardId);
      if (!guard) continue;
      att.signal = 'lost';
      att.noSignalAlerted = true;
      save();
      notify.raiseAlert(guard, 'NO_SIGNAL', `No location from ${guard.name} for over ${cfg.NO_SIGNAL_AFTER_SEC}s`,
        { attendanceId: att.id });
    }
  }

  // 2) Guards whose shift started but who have not checked in
  const d = new Date();
  const today = localDate(d);
  const minsNow = d.getHours() * 60 + d.getMinutes();
  for (const g of db.guards) {
    if (!g.active || !g.shift || g.absentAlertDate === today) continue;
    const start = toMinutes(g.shift.start);
    const end = toMinutes(g.shift.end);
    if (start == null || minsNow < start + cfg.LATE_GRACE_MIN) continue;
    if (end != null && end > start && minsNow >= end) continue; // day shift already over
    if (db.attendance.some((a) => a.guardId === g.id && a.date === today)) continue;
    g.absentAlertDate = today;
    save();
    notify.raiseAlert(g, 'NOT_CHECKED_IN', `${g.name} has not checked in (shift started at ${g.shift.start})`);
  }
}

const startWatchdog = () => setInterval(tick, 15000).unref();

module.exports = { openAttendance, siteOf, currentViolation, evaluate, closeAttendance, startWatchdog };
