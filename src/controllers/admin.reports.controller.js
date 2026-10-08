const Attendance = require('../models/Attendance.model');
const Guard = require('../models/Guard.model');
const Alert = require('../models/Alert.model');
const Location = require('../models/Location.model');
const monitor = require('../services/monitor.service');
const { attView } = require('./admin.sites.controller');
const { localDate } = require('../utils/date');

async function live(_req, res) {
  const open = await Attendance.find({ checkOutAt: null });
  const out = [];
  for (const a of open) {
    const g = await Guard.findById(a.guardId);
    out.push({
      attendanceId: a.id, guardId: a.guardId.toString(), name: g && g.name,
      siteId: a.siteId.toString(), zone: a.zone, signal: a.signal,
      checkInAt: a.checkInAt, lastSeenAt: a.lastSeenAt,
      location: a.lastLocation, outsideSeconds: a.outsideSeconds,
    });
  }
  res.json(out);
}

async function dashboard(_req, res) {
  const open = await Attendance.find({ checkOutAt: null });
  const today = localDate();
  const activeGuards = await Guard.find({ active: true });
  const todayRows = await Attendance.find({ date: today }).select('guardId');
  const checkedSet = new Set(todayRows.map((a) => a.guardId.toString()));
  const unack = await Alert.countDocuments({ acknowledged: false });
  const todayIds = activeGuards.map((g) => g._id);
  let notChecked = 0;
  for (const g of activeGuards) {
    if (!checkedSet.has(g._id.toString())) notChecked += 1;
  }
  void todayIds;
  res.json({
    guardsTotal: activeGuards.length,
    onDuty: open.length,
    outsideNow: open.filter((a) => a.zone === 'outside').length,
    signalLost: open.filter((a) => a.signal === 'lost').length,
    checkedInToday: checkedSet.size,
    notCheckedInToday: notChecked,
    unacknowledgedAlerts: unack,
  });
}

async function listAttendance(req, res) {
  const { guardId, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const q = {};
  if (guardId) q.guardId = guardId;
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = from;
    if (to) q.date.$lte = to;
  }
  const rows = await Attendance.find(q).sort({ checkInAt: -1 }).limit(limit);
  const out = [];
  for (const a of rows) {
    const g = await Guard.findById(a.guardId).select('name');
    out.push({ ...attView(a), guardName: g && g.name });
  }
  res.json(out);
}

async function getAttendance(req, res) {
  const a = await Attendance.findById(req.params.id);
  if (!a) return res.status(404).json({ error: 'attendance not found' });
  res.json(attView(a));
}

async function trail(req, res) {
  const rows = await Location.find({ attendanceId: req.params.id })
    .sort({ time: 1 })
    .limit(1000);
  res.json(rows.map((r) => r.toJSON()));
}

async function closeAttendance(req, res) {
  const a = await Attendance.findById(req.params.id);
  if (!a) return res.status(404).json({ error: 'attendance not found' });
  if (a.checkOutAt) return res.status(409).json({ error: 'already closed' });
  await monitor.closeAttendance(a, { by: `admin:${req.user.username}` });
  res.json(attView(a));
}

async function listAlerts(req, res) {
  const { guardId, type, unacknowledged } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const q = {};
  if (guardId) q.guardId = guardId;
  if (type) q.type = type;
  if (unacknowledged === '1') q.acknowledged = false;
  const rows = await Alert.find(q).sort({ time: -1 }).limit(limit);
  res.json(rows.map((r) => r.toJSON()));
}

async function ackAlert(req, res) {
  const a = await Alert.findById(req.params.id);
  if (!a) return res.status(404).json({ error: 'alert not found' });
  a.acknowledged = true;
  a.acknowledgedBy = req.user.username;
  a.acknowledgedAt = new Date().toISOString();
  await a.save();
  res.json(a.toJSON());
}

module.exports = {
  live, dashboard, listAttendance, getAttendance, trail,
  closeAttendance, listAlerts, ackAlert,
};
