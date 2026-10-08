const bcrypt = require('bcryptjs');
const path = require('path');
const Site = require('../models/Site.model');
const Guard = require('../models/Guard.model');
const User = require('../models/User.model');
const Attendance = require('../models/Attendance.model');
const Alert = require('../models/Alert.model');
const Location = require('../models/Location.model');
const monitor = require('../services/monitor.service');
const { uploader, checkImage, removeFile } = require('../uploads/uploader');
const { UPLOADS } = require('../uploads/folders');
const { fileUrl } = require('../utils/fileUrl');
const { validCoord } = require('../utils/coords');
const { toMinutes, localDate } = require('../utils/date');

const guardView = (g) => ({ ...g.toJSON(), profilePhotoUrl: fileUrl('profiles', g.profilePhoto) });
const attView = (a) => {
  const j = a.toJSON ? a.toJSON() : a;
  return {
    ...j,
    checkInPhotoUrl: fileUrl('attendance', j.checkInPhoto),
    checkOutPhotoUrl: fileUrl('attendance', j.checkOutPhoto),
  };
};

function validShift(shift) {
  if (shift == null) return true;
  return toMinutes(shift.start) != null && (shift.end == null || toMinutes(shift.end) != null);
}

function readSite(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'name required' };
    out.name = b.name.trim();
  }
  if (!partial || b.lat !== undefined || b.lng !== undefined) {
    if (!validCoord(b.lat, b.lng)) return { error: 'lat and lng must be valid numbers' };
    out.lat = b.lat;
    out.lng = b.lng;
  }
  if (!partial || b.radiusMeters !== undefined) {
    if (!(b.radiusMeters >= 10 && b.radiusMeters <= 10000))
      return { error: 'radiusMeters must be between 10 and 10000' };
    out.radiusMeters = b.radiusMeters;
  }
  if (b.address !== undefined) out.address = String(b.address);
  return { value: out };
}

// ---------- sites ----------
async function createSite(req, res) {
  const r = readSite(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const site = await Site.create(r.value);
  res.status(201).json(site.toJSON());
}

async function listSites(_req, res) {
  res.json((await Site.find().sort({ createdAt: -1 })).map((s) => s.toJSON()));
}

async function updateSite(req, res) {
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'site not found' });
  const r = readSite(req.body || {}, true);
  if (r.error) return res.status(400).json({ error: r.error });
  Object.assign(site, r.value);
  await site.save();
  res.json(site.toJSON());
}

async function deleteSite(req, res) {
  if (await Guard.exists({ siteId: req.params.id, active: true }))
    return res.status(409).json({ error: 'site still has active guards assigned' });
  const site = await Site.findByIdAndDelete(req.params.id);
  if (!site) return res.status(404).json({ error: 'site not found' });
  res.json({ ok: true });
}

module.exports = {
  guardView, attView, validShift, readSite,
  createSite, listSites, updateSite, deleteSite,
  uploadAvatar: uploader('profiles'),
};
