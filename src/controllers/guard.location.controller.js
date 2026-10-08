const monitor = require('../services/monitor.service');
const notify = require('../services/notify.service');
const { evaluate } = require('../services/evaluate.service');
const { readCoords } = require('../utils/coords');

async function location(req, res) {
  const g = req.guard;
  const att = await monitor.openAttendance(g._id);
  if (!att) return res.status(409).json({ error: 'no active attendance; check in first' });
  const c = readCoords(req.body);
  if (!c) return res.status(400).json({ error: 'valid lat and lng are required' });

  if (c.mocked) {
    if (!att.fakeGpsAlerted) {
      att.fakeGpsAlerted = true;
      await att.save();
      await notify.raiseAlert(g, 'FAKE_GPS', `${g.name}'s phone is reporting a mock/fake GPS location`, {
        attendanceId: att._id,
      });
    }
    return res.status(403).json({ error: 'mock locations are not allowed' });
  }
  res.json(await evaluate(g, att, await monitor.siteOf(g), c));
}

module.exports = { location };
