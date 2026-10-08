const Attendance = require('../models/Attendance.model');
const monitor = require('../services/monitor.service');
const notify = require('../services/notify.service');
const cfg = require('../config');
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

  const site = await monitor.siteOf(g);
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

module.exports = { checkIn, checkOut };
