const bcrypt = require('bcryptjs');
const Attendance = require('../models/Attendance.model');
const monitor = require('../services/monitor.service');
const { fileUrl } = require('../utils/fileUrl');
const { localDate } = require('../utils/date');

const attView = (a) => {
  const j = a.toJSON ? a.toJSON() : a;
  return {
    ...j,
    checkInPhotoUrl: fileUrl('attendance', j.checkInPhoto),
    checkOutPhotoUrl: fileUrl('attendance', j.checkOutPhoto),
  };
};

async function me(req, res) {
  const g = req.guard;
  const site = await monitor.siteOf(g);
  const open = await monitor.openAttendance(g._id);
  const todays =
    open || (await Attendance.findOne({ guardId: g._id, date: localDate() }).sort({ checkInAt: -1 }));
  res.json({
    profile: { ...g.toJSON(), profilePhotoUrl: fileUrl('profiles', g.profilePhoto) },
    site: site && {
      id: site.id, name: site.name, lat: site.lat, lng: site.lng,
      radiusMeters: site.radiusMeters,
    },
    onDuty: !!open,
    today: todays ? attView(todays) : null,
  });
}

async function changePassword(req, res) {
  const { oldPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    return res.status(400).json({ error: 'new password must be at least 6 characters' });
  if (typeof oldPassword !== 'string' || !bcrypt.compareSync(oldPassword, req.user.passwordHash))
    return res.status(403).json({ error: 'old password is wrong' });
  req.user.passwordHash = bcrypt.hashSync(newPassword, 10);
  await req.user.save();
  res.json({ ok: true });
}

async function history(req, res) {
  const rows = await Attendance.find({ guardId: req.guard._id })
    .sort({ checkInAt: -1 })
    .limit(30);
  res.json(rows.map(attView));
}

module.exports = { me, changePassword, history, attView };
