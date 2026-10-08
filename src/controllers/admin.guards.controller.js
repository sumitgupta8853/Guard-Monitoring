const bcrypt = require('bcryptjs');
const path = require('path');
const Site = require('../models/Site.model');
const Guard = require('../models/Guard.model');
const User = require('../models/User.model');
const monitor = require('../services/monitor.service');
const { checkImage, removeFile } = require('../uploads/uploader');
const { UPLOADS } = require('../uploads/folders');
const { guardView, validShift } = require('./admin.sites.controller');

async function createGuard(req, res) {
  const b = req.body || {};
  if (typeof b.name !== 'string' || !b.name.trim())
    return res.status(400).json({ error: 'name required' });
  if (typeof b.username !== 'string' || !/^[a-z0-9._-]{3,30}$/i.test(b.username))
    return res.status(400).json({ error: 'username must be 3-30 chars (letters, numbers, . _ -)' });
  if (typeof b.password !== 'string' || b.password.length < 6)
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (!(await Site.exists({ _id: b.siteId })))
    return res.status(400).json({ error: 'valid siteId required' });
  if (!validShift(b.shift))
    return res.status(400).json({ error: 'shift must look like { "start": "08:00", "end": "20:00" }' });
  const username = b.username.toLowerCase();
  if (await User.exists({ username }))
    return res.status(409).json({ error: 'username already taken' });

  const guard = await Guard.create({
    name: b.name.trim(), username,
    phone: b.phone || '', cnic: b.cnic || '', address: b.address || '',
    emergencyContact: b.emergencyContact || '',
    siteId: b.siteId, shift: b.shift || null, active: true, profilePhoto: null,
  });
  await User.create({
    username, passwordHash: bcrypt.hashSync(b.password, 10),
    role: 'guard', guardId: guard._id,
  });
  res.status(201).json(guardView(guard));
}

async function listGuards(_req, res) {
  const guards = await Guard.find().sort({ createdAt: -1 });
  const out = [];
  for (const g of guards) {
    const att = await monitor.openAttendance(g._id);
    out.push({
      ...guardView(g),
      onDuty: !!att,
      ...(att && {
        attendanceId: att.id, zone: att.zone, signal: att.signal,
        distanceMeters: att.lastLocation && att.lastLocation.distanceMeters,
        lastSeenAt: att.lastSeenAt,
      }),
    });
  }
  res.json(out);
}

async function getGuard(req, res) {
  const g = await Guard.findById(req.params.id);
  if (!g) return res.status(404).json({ error: 'guard not found' });
  res.json(guardView(g));
}

async function updateGuard(req, res) {
  const g = await Guard.findById(req.params.id);
  if (!g) return res.status(404).json({ error: 'guard not found' });
  const b = req.body || {};
  if (b.siteId !== undefined) {
    if (!(await Site.exists({ _id: b.siteId })))
      return res.status(400).json({ error: 'invalid siteId' });
    if (await monitor.openAttendance(g._id))
      return res.status(409).json({ error: 'guard is on duty; close attendance before changing site' });
  }
  if (b.shift !== undefined && !validShift(b.shift))
    return res.status(400).json({ error: 'invalid shift' });
  if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 6))
    return res.status(400).json({ error: 'password must be at least 6 characters' });

  for (const k of ['name', 'phone', 'cnic', 'address', 'emergencyContact', 'siteId', 'shift']) {
    if (b[k] !== undefined) g[k] = b[k];
  }
  await g.save();
  const user = await User.findOne({ guardId: g._id });
  if (user) {
    if (b.password) user.passwordHash = bcrypt.hashSync(b.password, 10);
    if (typeof b.active === 'boolean') user.disabled = !b.active;
    await user.save();
  }
  if (typeof b.active === 'boolean') {
    g.active = b.active;
    await g.save();
  }
  const fresh = await Guard.findById(g._id);
  res.json(guardView(fresh));
}

async function deleteGuard(req, res) {
  const g = await Guard.findById(req.params.id);
  if (!g) return res.status(404).json({ error: 'guard not found' });
  g.active = false;
  await g.save();
  await User.updateOne({ guardId: g._id }, { disabled: true });
  res.json({ ok: true });
}

async function uploadGuardPhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'photo required (field name: photo)' });
  if (!checkImage(req.file.path)) {
    removeFile(req.file.path);
    return res.status(400).json({ error: 'invalid image' });
  }
  const g = await Guard.findById(req.params.id);
  if (!g) {
    removeFile(req.file.path);
    return res.status(404).json({ error: 'guard not found' });
  }
  const old = g.profilePhoto;
  g.profilePhoto = req.file.filename;
  await g.save();
  if (old) removeFile(path.join(UPLOADS, 'profiles', old));
  res.json(guardView(g));
}

module.exports = { createGuard, listGuards, getGuard, updateGuard, deleteGuard, uploadGuardPhoto };
