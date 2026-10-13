const Attendance = require('../models/Attendance.model');
const monitor = require('../services/monitor.service');
const notify = require('../services/notify.service');
const cfg = require('../config');
const hourly = require('../services/hourly.service');
const { readCoords } = require('../utils/coords');
const { distanceMeters } = require('../utils/geo');
const { localDate, toMinutes } = require('../utils/date');
const { removeFile } = require('../uploads/uploader');
const { attView } = require('./guard.profile.controller');

async function checkIn(req, res) {
  const fail = (code, error, extra = {}) => {
    removeFile(req.file && req.file.path);
    return res.status(code).json({ error, ...extra });
  };
  const g = req.guard;

  if (!req.file) return fail(400, 'a live photo is required to start attendance (field name: photo)');
  const { checkImage } = require('../uploads/uploader');
  if (!checkImage(req.file.path)) return fail(400, 'invalid image');
  const c = readCoords(req.body);
  if (!c) return fail(400, 'valid lat and lng are required');
  if (c.mocked) {
    await notify.raiseAlert(g, 'FAKE_GPS', `${g.name} tried to check in with a mock/fake GPS location`);
    return fail(403, 'mock locations are not allowed');
  }
  const site = await monitor.siteOf(g);
  if (!site) return fail(409, 'no site assigned to you; contact admin');
  if (await monitor.openAttendance(g._id)) return fail(409, 'you are already checked in');
  const today = localDate();
  if (await Attendance.exists({ guardId: g._id, date: today }))
    return fail(409, 'your attendance for today is already completed');
  if (c.accuracy > cfg.MAX_ACCURACY_M)
    return fail(422, `GPS accuracy is too low (${Math.round(c.accuracy)}m). Move to open sky and try again.`);

  const dist = distanceMeters(c.lat, c.lng, site.lat, site.lng);
  if (dist > site.radiusMeters)
    return fail(403, `You are ${Math.round(dist)}m from "${site.name}". You must be within ${site.radiusMeters}m to start attendance.`,
      { distanceMeters: Math.round(dist), radiusMeters: site.radiusMeters });

  const now = new Date();
  let late = false;
  let lateMinutes = 0;
  const start = g.shift && toMinutes(g.shift.start);
  if (start != null) {
    lateMinutes = now.getHours() * 60 + now.getMinutes() - start;
    late = lateMinutes > cfg.LATE_GRACE_MIN;
    lateMinutes = Math.max(0, lateMinutes);
  }

  const att = await Attendance.create({
    guardId: g._id, siteId: site._id, date: today,
    checkInAt: now.toISOString(), checkInPhoto: req.file.filename,
    checkInLocation: { lat: c.lat, lng: c.lng, accuracy: c.accuracy, distanceMeters: Math.round(dist) },
    late, lateMinutes, checkOutAt: null, checkOutPhoto: null,
    checkOutLocation: null, closedBy: null,
    zone: 'inside', signal: 'ok', outsideCount: 0, noSignalAlerted: false,
    lastSeenAt: now.toISOString(), lastSeenMs: now.getTime(), lastLocation: null,
    violations: [], outsideSeconds: 0, fakeGpsAlerted: false,
  });
  notify.toAdmins('attendance:start', {
    attendanceId: att.id, guardId: g.id, name: g.name, late, checkInAt: att.checkInAt,
  });
  res.status(201).json(attView(att));
}

async function checkOut(req, res) {
  const fail = (code, error, extra = {}) => {
    removeFile(req.file && req.file.path);
    return res.status(code).json({ error, ...extra });
  };
  const g = req.guard;
  const att = await monitor.openAttendance(g._id);
  if (!att) return fail(409, 'you are not checked in');
  const { checkImage } = require('../uploads/uploader');
  if (req.file && !checkImage(req.file.path)) return fail(400, 'invalid image');
  const c = readCoords(req.body);
  if (!c) return fail(400, 'valid lat and lng are required');
  if (c.mocked) {
    if (!att.fakeGpsAlerted) {
      att.fakeGpsAlerted = true;
      await att.save();
      await notify.raiseAlert(g, 'FAKE_GPS', `${g.name} tried to check out with a mock/fake GPS location`, {
        attendanceId: att._id,
      });
    }
    return fail(403, 'mock locations are not allowed');
  }
  if (c.accuracy > cfg.MAX_ACCURACY_M)
    return fail(422, `GPS accuracy is too low (${Math.round(c.accuracy)}m). Move to open sky and try again.`);

  const site = await monitor.siteOf(g);
  if (!site) return fail(409, 'no site assigned to you; contact admin');
  const dist = distanceMeters(c.lat, c.lng, site.lat, site.lng);
  if (dist - c.accuracy > site.radiusMeters)
    return fail(403, `You are ${Math.round(dist)}m from "${site.name}". Return to the site to check out, or ask your admin.`,
      { distanceMeters: Math.round(dist), radiusMeters: site.radiusMeters });

  await monitor.closeAttendance(att, {
    by: 'guard',
    photo: req.file ? req.file.filename : null,
    location: { lat: c.lat, lng: c.lng, accuracy: c.accuracy, distanceMeters: Math.round(dist) },
  });
  notify.toAdmins('attendance:end', {
    attendanceId: att.id, guardId: g.id, name: g.name, checkOutAt: att.checkOutAt,
  });
  res.json(attView(att));
}

// ---------- hourly proof-of-presence photo (STRICT window) ----------
// Guard must upload a live photo every hour between check-in and check-out.
// Wall-clock slots: the 11:00 photo is accepted ONLY inside [10:55, 11:05]
// (HOURLY_EARLY_MIN / HOURLY_LATE_MIN). Not before, not after — a closed
// window with no photo is a permanent miss. multipart: photo, lat, lng,
// accuracy, optional mocked. Same geofence rule as check-in.
async function hourlyPhoto(req, res) {
  const fail = (code, error, extra = {}) => {
    removeFile(req.file && req.file.path);
    return res.status(code).json({ error, ...extra });
  };
  const g = req.guard;
  const att = await monitor.openAttendance(g._id);
  if (!att) return fail(409, 'you are not checked in');
  if (!req.file) return fail(400, 'a live photo is required (field name: photo)');
  const { checkImage } = require('../uploads/uploader');
  if (!checkImage(req.file.path)) return fail(400, 'invalid image');

  // STRICT gate first: is any slot window open right now?
  const now = new Date();
  const slot = hourly.activeSlot(att, now.getTime());
  if (slot == null) {
    const upcoming = hourly.nextOpenSlot(att, now.getTime());
    const w = hourly.windowOf(att, upcoming);
    const iso = (ms) => new Date(ms).toISOString();
    const localT = (ms) => new Date(ms).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: process.env.TZ || 'Asia/Kolkata',
    });
    return fail(425, 'photo window is closed — upload only within the slot time (not before, not after)',
      {
        activeSlot: null,
        nextSlot: upcoming,
        nextOpenAt: iso(w.openAt),
        nextDueAt: iso(w.dueAt),
        nextCloseAt: iso(w.closeAt),
        nextOpenAtLocal: localT(w.openAt),
        nextDueAtLocal: localT(w.dueAt),
        nextCloseAtLocal: localT(w.closeAt),
        nextWindowLabel: `${localT(w.openAt)}–${localT(w.closeAt)}`,
        tz: process.env.TZ || 'Asia/Kolkata',
        hourly: hourly.hourlyStatus(att, now.getTime()),
      });
  }
  const done = hourly.uploadedSlots(att);
  if (done.has(slot)) {
    const w = hourly.windowOf(att, slot);
    return fail(409, `hourly photo #${slot} already uploaded`, {
      slotIndex: slot,
      nextOpenAt: new Date(hourly.windowOf(att, slot + 1).openAt).toISOString(),
      windowCloseAt: new Date(w.closeAt).toISOString(),
    });
  }

  const c = readCoords(req.body);
  if (!c) return fail(400, 'valid lat and lng are required');
  if (c.mocked) {
    if (!att.fakeGpsAlerted) {
      att.fakeGpsAlerted = true;
      await att.save();
      await notify.raiseAlert(g, 'FAKE_GPS', `${g.name} tried hourly photo with a mock/fake GPS location`, {
        attendanceId: att._id,
      });
    }
    return fail(403, 'mock locations are not allowed');
  }
  if (c.accuracy > cfg.MAX_ACCURACY_M)
    return fail(422, `GPS accuracy is too low (${Math.round(c.accuracy)}m). Move to open sky and try again.`);

  const site = await monitor.siteOf(g);
  if (!site) return fail(409, 'no site assigned to you; contact admin');
  const dist = distanceMeters(c.lat, c.lng, site.lat, site.lng);
  if (dist > site.radiusMeters)
    return fail(403, `You are ${Math.round(dist)}m from "${site.name}". Return inside ${site.radiusMeters}m to upload your hourly photo.`,
      { distanceMeters: Math.round(dist), radiusMeters: site.radiusMeters });

  const w = hourly.windowOf(att, slot);
  const overdue = now.getTime() > w.dueAt; // uploaded in (due, close]: accepted but late
  att.hourlyPhotos.push({
    at: now.toISOString(),
    photo: req.file.filename,
    lat: c.lat, lng: c.lng, accuracy: c.accuracy,
    distanceMeters: Math.round(dist),
    slotIndex: slot,
    overdue,
  });
  att.lastHourlyPhotoAt = now.toISOString();
  att.lastHourlyPhotoMs = now.getTime();
  await att.save();
  notify.toAdmins('guard:update', {
    guardId: g._id, name: g.name, attendanceId: att._id,
    hourlyPhoto: slot, photoAt: att.lastHourlyPhotoAt,
  });
  const status = hourly.hourlyStatus(att);
  notify.toGuard(g._id, 'hourly', {
    message: overdue
      ? `Hourly photo #${slot} received (late). ${status.message}`
      : `Hourly photo #${slot} received. ${status.message}`,
    slotIndex: slot,
    overdue,
    hourly: status,
  });
  res.status(201).json({ ok: true, slotIndex: slot, overdue, hourly: status, attendance: attView(att) });
}

module.exports = { checkIn, checkOut, hourlyPhoto };
