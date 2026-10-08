const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, save, id, FOLDERS } = require('../db');
const { requireAuth } = require('../auth');
const { uploader, checkImage, removeFile } = require('../upload');
const monitor = require('../monitor');
const notify = require('../notify');
const cfg = require('../config');
const { readCoords, distanceMeters, localDate, toMinutes } = require('../util');

router.use(requireAuth('guard'));

// Shared photo folder helper. Only the logical folders that exist under UPLOADS
// are served, so callers can't build a path outside those directories.
const fileUrl = (folder, name) => {
  const valid = Object.values(FOLDERS).includes(folder);
  return valid && name ? `/api/files/${folder}/${name}` : null;
};
const attView = (a) => ({
  ...a,
  checkInPhotoUrl: fileUrl('attendance', a.checkInPhoto),
  checkOutPhotoUrl: fileUrl('attendance', a.checkOutPhoto),
});

// ---------- profile ----------
router.get('/me', (req, res) => {
  const g = req.guard;
  const site = monitor.siteOf(g);
  const open = monitor.openAttendance(g.id);
  const todays = open || db.attendance.find((a) => a.guardId === g.id && a.date === localDate());
  res.json({
    profile: { ...g, profilePhotoUrl: fileUrl('profiles', g.profilePhoto) },
    site: site && { id: site.id, name: site.name, lat: site.lat, lng: site.lng, radiusMeters: site.radiusMeters },
    onDuty: !!open,
    today: todays ? attView(todays) : null,
  });
});

router.post('/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    return res.status(400).json({ error: 'new password must be at least 6 characters' });
  if (typeof oldPassword !== 'string' || !bcrypt.compareSync(oldPassword, req.user.passwordHash))
    return res.status(403).json({ error: 'old password is wrong' });
  req.user.passwordHash = bcrypt.hashSync(newPassword, 10);
  save();
  res.json({ ok: true });
});

// ---------- attendance: check-in (photo + location, must be inside the area) ----------
router.post('/attendance/check-in', uploader('attendance').single('photo'), (req, res) => {
  const fail = (code, error, extra = {}) => { removeFile(req.file && req.file.path); return res.status(code).json({ error, ...extra }); };
  const g = req.guard;

  if (!req.file) return fail(400, 'a live photo is required to start attendance (field name: photo)');
  if (!checkImage(req.file.path)) return fail(400, 'invalid image');
  const c = readCoords(req.body);
  if (!c) return fail(400, 'valid lat and lng are required');
  if (c.mocked) {
    notify.raiseAlert(g, 'FAKE_GPS', `${g.name} tried to check in with a mock/fake GPS location`);
    return fail(403, 'mock locations are not allowed');
  }
  const site = monitor.siteOf(g);
  if (!site) return fail(409, 'no site assigned to you; contact admin');
  if (monitor.openAttendance(g.id)) return fail(409, 'you are already checked in');
  const today = localDate();
  if (db.attendance.some((a) => a.guardId === g.id && a.date === today))
    return fail(409, 'your attendance for today is already completed');
  if (c.accuracy > cfg.MAX_ACCURACY_M)
    return fail(422, `GPS accuracy is too low (${Math.round(c.accuracy)}m). Move to open sky and try again.`);

  const dist = distanceMeters(c.lat, c.lng, site.lat, site.lng);
  if (dist > site.radiusMeters)
    return fail(403, `You are ${Math.round(dist)}m from "${site.name}". You must be within ${site.radiusMeters}m to start attendance.`,
      { distanceMeters: Math.round(dist), radiusMeters: site.radiusMeters });

  const now = new Date();
  let late = false, lateMinutes = 0;
  const start = g.shift && toMinutes(g.shift.start);
  if (start != null) {
    lateMinutes = now.getHours() * 60 + now.getMinutes() - start;
    late = lateMinutes > cfg.LATE_GRACE_MIN;
    lateMinutes = Math.max(0, lateMinutes);
  }

  const att = {
    id: id(), guardId: g.id, siteId: site.id, date: today,
    checkInAt: now.toISOString(), checkInPhoto: req.file.filename,
    checkInLocation: { lat: c.lat, lng: c.lng, accuracy: c.accuracy, distanceMeters: Math.round(dist) },
    late, lateMinutes,
    checkOutAt: null, checkOutPhoto: null, checkOutLocation: null, closedBy: null,
    zone: 'inside', signal: 'ok', outsideCount: 0, noSignalAlerted: false,
    lastSeenAt: now.toISOString(), lastSeenMs: now.getTime(), lastLocation: null,
    violations: [], outsideSeconds: 0, fakeGpsAlerted: false,
  };
  db.attendance.push(att);
  save();
  notify.toAdmins('attendance:start', { attendanceId: att.id, guardId: g.id, name: g.name, late, checkInAt: att.checkInAt });
  res.status(201).json(attView(att));
});

// ---------- attendance: check-out (photo optional, must be back inside the area) ----------
router.post('/attendance/check-out', uploader('attendance').single('photo'), (req, res) => {
  const fail = (code, error, extra = {}) => { removeFile(req.file && req.file.path); return res.status(code).json({ error, ...extra }); };
  const g = req.guard;
  const att = monitor.openAttendance(g.id);
  if (!att) return fail(409, 'you are not checked in');
  if (req.file && !checkImage(req.file.path)) return fail(400, 'invalid image');
  const c = readCoords(req.body);
  if (!c) return fail(400, 'valid lat and lng are required');

  const site = monitor.siteOf(g);
  const dist = distanceMeters(c.lat, c.lng, site.lat, site.lng);
  if (dist - c.accuracy > site.radiusMeters)
    return fail(403, `You are ${Math.round(dist)}m from "${site.name}". Return to the site to check out, or ask your admin.`,
      { distanceMeters: Math.round(dist), radiusMeters: site.radiusMeters });

  monitor.closeAttendance(att, {
    by: 'guard', photo: req.file ? req.file.filename : null,
    location: { lat: c.lat, lng: c.lng, accuracy: c.accuracy, distanceMeters: Math.round(dist) },
  });
  notify.toAdmins('attendance:end', { attendanceId: att.id, guardId: g.id, name: g.name, checkOutAt: att.checkOutAt });
  res.json(attView(att));
});

// ---------- location ping (the guard app sends this every 10-30 s while on duty) ----------
router.post('/location', (req, res) => {
  const g = req.guard;
  const att = monitor.openAttendance(g.id);
  if (!att) return res.status(409).json({ error: 'no active attendance; check in first' });
  const c = readCoords(req.body);
  if (!c) return res.status(400).json({ error: 'valid lat and lng are required' });

  if (c.mocked) {
    if (!att.fakeGpsAlerted) {
      att.fakeGpsAlerted = true; save();
      notify.raiseAlert(g, 'FAKE_GPS', `${g.name}'s phone is reporting a mock/fake GPS location`, { attendanceId: att.id });
    }
    return res.status(403).json({ error: 'mock locations are not allowed' });
  }
  res.json(monitor.evaluate(g, att, monitor.siteOf(g), c));
});

// ---------- history ----------
router.get('/attendance', (req, res) =>
  res.json(db.attendance.filter((a) => a.guardId === req.guard.id).slice(-30).reverse().map(attView)));

module.exports = router;
