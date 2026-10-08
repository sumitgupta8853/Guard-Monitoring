// Core rules: attendance state, geofence evaluation, violations, watchdog.
const cfg = require('../config');
const Attendance = require('../models/Attendance.model');
const Guard = require('../models/Guard.model');
const Site = require('../models/Site.model');
const Location = require('../models/Location.model');
const notify = require('./notify.service');
const { distanceMeters } = require('../utils/geo');
const { localDate, toMinutes } = require('../utils/date');

const openAttendance = (guardId) =>
  Attendance.findOne({ guardId, checkOutAt: null });

const siteOf = async (guard) => {
  if (!guard || !guard.siteId) return null;
  return Site.findById(guard.siteId);
};

const currentViolation = (att) => att.violations.find((v) => !v.endedAt);

function closeViolation(att, at = new Date()) {
  const v = currentViolation(att);
  if (!v) return null;
  v.endedAt = at.toISOString();
  v.seconds = Math.round((at - new Date(v.startedAt)) / 1000);
  att.outsideSeconds += v.seconds;
  return v;
}

async function closeAttendance(att, { by, photo = null, location = null }) {
  const now = new Date();
  closeViolation(att, now);
  att.checkOutAt = now.toISOString();
  att.checkOutPhoto = photo;
  att.checkOutLocation = location;
  att.closedBy = by;
  att.workedSeconds = Math.round((now - new Date(att.checkInAt)) / 1000);
  att.insideSeconds = Math.max(0, att.workedSeconds - att.outsideSeconds);
  await att.save();
  return att;
}

async function tick() {
  const nowMs = Date.now();
  const open = await Attendance.find({ checkOutAt: null });
  for (const att of open) {
    if (att.signal === 'lost') continue;
    if (nowMs - att.lastSeenMs > cfg.NO_SIGNAL_AFTER_SEC * 1000) {
      const guard = await Guard.findById(att.guardId);
      if (!guard) continue;
      att.signal = 'lost';
      att.noSignalAlerted = true;
      await att.save();
      await notify.raiseAlert(guard, 'NO_SIGNAL',
        `No location from ${guard.name} for over ${cfg.NO_SIGNAL_AFTER_SEC}s`,
        { attendanceId: att._id });
    }
  }
  const d = new Date();
  const today = localDate(d);
  const minsNow = d.getHours() * 60 + d.getMinutes();
  const guards = await Guard.find({ active: true });
  for (const g of guards) {
    if (!g.shift || !g.shift.start || g.absentAlertDate === today) continue;
    const start = toMinutes(g.shift.start);
    const end = toMinutes(g.shift.end);
    if (start == null || minsNow < start + cfg.LATE_GRACE_MIN) continue;
    if (end != null && end > start && minsNow >= end) continue;
    const hasToday = await Attendance.exists({ guardId: g._id, date: today });
    if (hasToday) continue;
    g.absentAlertDate = today;
    await g.save();
    await notify.raiseAlert(g, 'NOT_CHECKED_IN',
      `${g.name} has not checked in (shift started at ${g.shift.start})`);
  }
}

const startWatchdog = () =>
  setInterval(() => tick().catch((e) => console.error('[watchdog]', e)), 15000).unref();

module.exports = { openAttendance, siteOf, currentViolation, closeViolation, closeAttendance, tick, startWatchdog };
