const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, save, id, FOLDERS } = require('../db');
const { requireAuth } = require('../auth');
const { uploader, checkImage, removeFile } = require('../upload');
const monitor = require('../monitor');
const { toMinutes, localDate } = require('../util');

// Shared photo folder helper. Only the logical folders that exist under UPLOADS
// are served, so callers can't build a path outside those directories.
const fileUrl = (folder, name) => {
  const valid = Object.values(FOLDERS).includes(folder);
  return valid && name ? `/api/files/${folder}/${name}` : null;
};

router.use(requireAuth('admin'));

// ---------- helpers ----------
const validCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const guardView = (g) => ({ ...g, profilePhotoUrl: fileUrl('profiles', g.profilePhoto) });
const attView = (a) => ({
  ...a,
  checkInPhotoUrl: fileUrl('attendance', a.checkInPhoto),
  checkOutPhotoUrl: fileUrl('attendance', a.checkOutPhoto),
});

function validShift(shift) {
  if (shift == null) return true;
  return toMinutes(shift.start) != null && (shift.end == null || toMinutes(shift.end) != null);
}

// ---------- sites ----------
function readSite(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'name required' };
    out.name = b.name.trim();
  }
  if (!partial || b.lat !== undefined || b.lng !== undefined) {
    if (!validCoord(b.lat, b.lng)) return { error: 'lat and lng must be valid numbers' };
    out.lat = b.lat; out.lng = b.lng;
  }
  if (!partial || b.radiusMeters !== undefined) {
    if (!(b.radiusMeters >= 10 && b.radiusMeters <= 10000)) return { error: 'radiusMeters must be between 10 and 10000' };
    out.radiusMeters = b.radiusMeters;
  }
  if (b.address !== undefined) out.address = String(b.address);
  return { value: out };
}

router.post('/sites', (req, res) => {
  const r = readSite(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const site = { id: id(), createdAt: new Date().toISOString(), ...r.value };
  db.sites.push(site); save();
  res.status(201).json(site);
});

router.get('/sites', (_req, res) => res.json(db.sites));

router.put('/sites/:id', (req, res) => {
  const site = db.sites.find((s) => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: 'site not found' });
  const r = readSite(req.body || {}, true);
  if (r.error) return res.status(400).json({ error: r.error });
  Object.assign(site, r.value); save();
  res.json(site);
});

router.delete('/sites/:id', (req, res) => {
  if (db.guards.some((g) => g.siteId === req.params.id && g.active))
    return res.status(409).json({ error: 'site still has active guards assigned' });
  const i = db.sites.findIndex((s) => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'site not found' });
  db.sites.splice(i, 1); save();
  res.json({ ok: true });
});

// ---------- guard profiles ----------
router.post('/guards', (req, res) => {
  const b = req.body || {};
  if (typeof b.name !== 'string' || !b.name.trim()) return res.status(400).json({ error: 'name required' });
  if (typeof b.username !== 'string' || !/^[a-z0-9._-]{3,30}$/i.test(b.username))
    return res.status(400).json({ error: 'username must be 3-30 chars (letters, numbers, . _ -)' });
  if (typeof b.password !== 'string' || b.password.length < 6)
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (!db.sites.find((s) => s.id === b.siteId)) return res.status(400).json({ error: 'valid siteId required' });
  if (!validShift(b.shift)) return res.status(400).json({ error: 'shift must look like { "start": "08:00", "end": "20:00" }' });
  const username = b.username.toLowerCase();
  if (db.users.some((u) => u.username === username)) return res.status(409).json({ error: 'username already taken' });

  const guard = {
    id: id(), name: b.name.trim(), username,
    phone: b.phone || '', cnic: b.cnic || '', address: b.address || '', emergencyContact: b.emergencyContact || '',
    siteId: b.siteId, shift: b.shift || null, active: true, profilePhoto: null, createdAt: new Date().toISOString(),
  };
  db.guards.push(guard);
  db.users.push({ id: id(), username, passwordHash: bcrypt.hashSync(b.password, 10), role: 'guard', guardId: guard.id });
  save();
  res.status(201).json(guardView(guard));
});

router.get('/guards', (_req, res) => {
  res.json(db.guards.map((g) => {
    const att = monitor.openAttendance(g.id);
    return {
      ...guardView(g),
      onDuty: !!att,
      ...(att && {
        attendanceId: att.id, zone: att.zone, signal: att.signal,
        distanceMeters: att.lastLocation && att.lastLocation.distanceMeters, lastSeenAt: att.lastSeenAt,
      }),
    };
  }));
});

router.get('/guards/:id', (req, res) => {
  const g = db.guards.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'guard not found' });
  res.json(guardView(g));
});

router.put('/guards/:id', (req, res) => {
  const g = db.guards.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'guard not found' });
  const b = req.body || {};
  if (b.siteId !== undefined) {
    if (!db.sites.find((s) => s.id === b.siteId)) return res.status(400).json({ error: 'invalid siteId' });
    if (monitor.openAttendance(g.id)) return res.status(409).json({ error: 'guard is on duty; close attendance before changing site' });
  }
  if (b.shift !== undefined && !validShift(b.shift)) return res.status(400).json({ error: 'invalid shift' });
  if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 6))
    return res.status(400).json({ error: 'password must be at least 6 characters' });

  for (const k of ['name', 'phone', 'cnic', 'address', 'emergencyContact', 'siteId', 'shift']) {
    if (b[k] !== undefined) g[k] = b[k];
  }
  const user = db.users.find((u) => u.guardId === g.id);
  if (b.password) user.passwordHash = bcrypt.hashSync(b.password, 10);
  if (typeof b.active === 'boolean') { g.active = b.active; user.disabled = !b.active; }
  save();
  res.json(guardView(g));
});

router.delete('/guards/:id', (req, res) => {
  const g = db.guards.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'guard not found' });
  g.active = false;
  const user = db.users.find((u) => u.guardId === g.id);
  if (user) user.disabled = true;
  save();
  res.json({ ok: true, note: 'guard deactivated; attendance history is kept' });
});

router.post('/guards/:id/photo',
  (req, res, next) => (db.guards.find((x) => x.id === req.params.id) ? next() : res.status(404).json({ error: 'guard not found' })),
  uploader('profiles').single('photo'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'photo file required (field name: photo)' });
    if (!checkImage(req.file.path)) { removeFile(req.file.path); return res.status(400).json({ error: 'invalid image' }); }
    const g = db.guards.find((x) => x.id === req.params.id);
    const old = g.profilePhoto;
    g.profilePhoto = req.file.filename;
    if (old) removeFile(require('path').join(require('../db').UPLOADS, 'profiles', old));
    save();
    res.json(guardView(g));
  });

// ---------- live view, dashboard ----------
router.get('/live', (_req, res) => {
  res.json(db.attendance.filter((a) => !a.checkOutAt).map((a) => {
    const g = db.guards.find((x) => x.id === a.guardId);
    return {
      attendanceId: a.id, guardId: a.guardId, name: g && g.name, siteId: a.siteId,
      zone: a.zone, signal: a.signal, checkInAt: a.checkInAt, lastSeenAt: a.lastSeenAt,
      location: a.lastLocation, outsideSeconds: a.outsideSeconds,
    };
  }));
});

router.get('/dashboard', (_req, res) => {
  const open = db.attendance.filter((a) => !a.checkOutAt);
  const today = localDate();
  const activeGuards = db.guards.filter((g) => g.active);
  res.json({
    guardsTotal: activeGuards.length,
    onDuty: open.length,
    outsideNow: open.filter((a) => a.zone === 'outside').length,
    signalLost: open.filter((a) => a.signal === 'lost').length,
    checkedInToday: new Set(db.attendance.filter((a) => a.date === today).map((a) => a.guardId)).size,
    notCheckedInToday: activeGuards.filter((g) => !db.attendance.some((a) => a.guardId === g.id && a.date === today)).length,
    unacknowledgedAlerts: db.alerts.filter((a) => !a.acknowledged).length,
  });
});

// ---------- attendance ----------
router.get('/attendance', (req, res) => {
  const { guardId, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.attendance
    .filter((a) => (!guardId || a.guardId === guardId) && (!from || a.date >= from) && (!to || a.date <= to))
    .slice(-limit).reverse()
    .map((a) => ({ ...attView(a), guardName: (db.guards.find((g) => g.id === a.guardId) || {}).name })));
});

router.get('/attendance/:id', (req, res) => {
  const a = db.attendance.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'attendance not found' });
  res.json(attView(a));
});

router.get('/attendance/:id/trail', (req, res) =>
  res.json(db.locations.filter((l) => l.attendanceId === req.params.id).slice(-1000)));

// Force-close (guard's phone died, guard quit mid-shift, etc.)
router.post('/attendance/:id/close', (req, res) => {
  const a = db.attendance.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'attendance not found' });
  if (a.checkOutAt) return res.status(409).json({ error: 'already closed' });
  monitor.closeAttendance(a, { by: `admin:${req.user.username}` });
  res.json(attView(a));
});

// ---------- alerts ----------
router.get('/alerts', (req, res) => {
  const { guardId, type, unacknowledged } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.alerts
    .filter((a) => (!guardId || a.guardId === guardId) && (!type || a.type === type) && (unacknowledged !== '1' || !a.acknowledged))
    .slice(-limit).reverse());
});

router.post('/alerts/:id/ack', (req, res) => {
  const a = db.alerts.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'alert not found' });
  a.acknowledged = true; a.acknowledgedBy = req.user.username; a.acknowledgedAt = new Date().toISOString();
  save();
  res.json(a);
});

module.exports = router;
