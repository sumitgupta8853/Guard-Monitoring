// Core rules: attendance state, geofence evaluation, violations, watchdog.
// Core rules: attendance state, geofence evaluation, violations, watchdog.
const cfg = require('../config');
const Attendance = require('../models/Attendance.model');
const Guard = require('../models/Guard.model');
const Site = require('../models/Site.model');
const Location = require('../models/Location.model');
const notify = require('./notify.service');
const push = require('./push.service');
const hourly = require('./hourly.service');
const { distanceMeters } = require('../utils/geo');
const { localDate, toMinutes, shiftStatus } = require('../utils/date');

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

  // Hourly photo reminder: push the guard once when a slot's window OPENS.
  for (const att of open) {
    try {
      const done = hourly.uploadedSlots(att);
      let dirty = false;
      for (let s = (att.hourlyOpenNotifiedSlot || 0) + 1; ; s += 1) {
        const w = hourly.windowOf(att, s);
        if (nowMs < w.openAt) break; // window not open yet: wait
        if (nowMs < w.closeAt && !done.has(s) && push.enabled()) {
          push.pushGuardWarning(
            att.guardId,
            'Photo window is open',
            `Upload hourly photo #${s} now (${hourly.fmtLocalT(w.openAt)}–${hourly.fmtLocalT(w.closeAt)}).`,
            { type: 'HOURLY_WINDOW_OPEN', attendanceId: String(att._id || ''), slot: String(s) }
          );
        }
        att.hourlyOpenNotifiedSlot = s; // mark as handled, even if already closed
        dirty = true;
        if (s > 1000) break;
      }
      if (dirty) await att.save();
    } catch (e) {
      console.error('[watchdog:hourly-open]', e.message);
    }
  }
  // Hourly photo watch (STRICT): one MISSING_HOURLY_PHOTO alert per slot whose
  // window CLOSED with no photo. Permanent miss — watchdog only advances.
  for (const att of open) {
    try {
      const done = hourly.uploadedSlots(att);
      let dirty = false;
      for (let s = (att.hourlyAlertSlot || 0) + 1; ; s += 1) {
        const w = hourly.windowOf(att, s);
        if (nowMs < w.closeAt) break; // window still open (or future): wait
        if (done.has(s)) { att.hourlyAlertSlot = s; dirty = true; continue; }
        const guard = await Guard.findById(att.guardId);
        if (guard) {
          const nw = hourly.windowOf(att, s + 1);
          await notify.raiseAlert(guard, 'MISSING_HOURLY_PHOTO',
            `${guard.name} missed hourly photo #${s} (window ${hourly.fmtLocalT(w.openAt)}–${hourly.fmtLocalT(w.closeAt)}; photo accepted only within the slot time)`,
            { attendanceId: att._id });
          notify.toGuard(att.guardId, 'warning', {
            message: `Hourly photo #${s} MISSED (window closed). Next window ${hourly.fmtLocalT(nw.openAt)}–${hourly.fmtLocalT(nw.closeAt)} — upload only within the slot time.`,
            hourly: hourly.hourlyStatus(att, nowMs),
          });
          if (push.enabled()) {
            push.pushGuardWarning(
              att.guardId,
              'Hourly photo missed',
              `Photo #${s} window closed. Next: ${hourly.fmtLocalT(nw.openAt)}–${hourly.fmtLocalT(nw.closeAt)}.`,
              { type: 'MISSING_HOURLY_PHOTO', attendanceId: String(att._id || '') }
            );
          }
        }
        att.hourlyAlertSlot = s;
        dirty = true;
        if (s > 1000) break;
      }
      if (dirty) await att.save();
    } catch (e) {
      console.error('[watchdog:hourly]', e.message);
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

  // Shift-end auto-close: close any open attendance whose shift ended more
  // than SHIFT_AUTO_CLOSE_AFTER_MIN ago (covers day + overnight shifts).
  // Hourly photos / check-out after the shift window are already rejected
  // by the controller gates; this prevents stale "on duty" rows.
  try {
    const stillOpen = await Attendance.find({ checkOutAt: null });
    for (const att of stillOpen) {
      const guard = await Guard.findById(att.guardId);
      if (!guard || !guard.shift || toMinutes(guard.shift.start) == null) continue;
      const st = shiftStatus(
        guard.shift, d,
        { earlyAllowMin: cfg.SHIFT_CHECKIN_EARLY_MIN, endGraceMin: cfg.SHIFT_AUTO_CLOSE_AFTER_MIN }
      );
      if (st.ok || st.reason !== 'SHIFT_ENDED' || st.noShift) continue;
      await closeAttendance(att, { by: 'system (shift ended)', photo: null, location: null });
      await notify.raiseAlert(guard, 'SHIFT_AUTO_CLOSE',
        `${guard.name} was auto checked-out — shift ended at ${guard.shift.end}`,
        { attendanceId: att._id });
      notify.toAdmins('attendance:end', {
        attendanceId: att.id, guardId: guard.id, name: guard.name,
        checkOutAt: att.checkOutAt, autoClosed: true,
      });
    }
  } catch (e) {
    console.error('[watchdog:shift-auto-close]', e.message);
  }
}

const startWatchdog = () =>
  setInterval(() => tick().catch((e) => console.error('[watchdog]', e)), 15000).unref();

module.exports = { openAttendance, siteOf, currentViolation, closeViolation, closeAttendance, tick, startWatchdog };