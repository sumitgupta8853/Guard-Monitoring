const cfg = require('../config');
const monitor = require('../services/monitor.service');
const notify = require('../services/notify.service');
const { evaluate } = require('../services/evaluate.service');
const { readCoords, readBatch } = require('../utils/coords');

// POST /api/guard/location — two shapes, same URL:
//   Single ping (legacy):  { lat, lng, accuracy?, mocked? }
//   15-min batch (new):    { points: [{ lat, lng, accuracy?, at?, mocked? }, ...] }
//                          (`locations` accepted as an alias for `points`.)
// The app records GPS every ~20 s locally, then uploads the buffered array
// every 15 min. Points replay oldest-first so the radius check + LEFT_AREA /
// RETURNED alerts reflect when the guard actually left, not when the batch
// arrived (up to 15 min later).
async function location(req, res) {
  const g = req.guard;
  const att = await monitor.openAttendance(g._id);
  if (!att) return res.status(409).json({ error: 'no active attendance; check in first' });
  const site = await monitor.siteOf(g);
  if (!site) return res.status(409).json({ error: 'no site assigned to you; contact admin' });

  const batch = readBatch(req.body, cfg.LOCATION_BATCH_MAX);
  if (batch && batch.error) return res.status(400).json({ error: batch.error });
  if (batch) return locationBatch(req, res, g, att, site, batch);

  const c = readCoords(req.body);
  if (!c) return res.status(400).json({ error: 'valid lat and lng are required' });

  if (c.mocked) {
    await flagFakeGps(g, att);
    return res.status(403).json({ error: 'mock locations are not allowed' });
  }
  res.json(await evaluate(g, att, site, c, c.at));
}

async function locationBatch(req, res, g, att, site, { points, invalid }) {
  let saved = 0, ignored = 0, mocked = 0, alerted = false;
  let last = null;

  const zoneBefore = att.zone;
  for (const p of points) {
    if (p.mocked) {
      mocked += 1;
      await flagFakeGps(g, att);
      continue;
    }
    last = await evaluate(g, att, site, p, p.at);
    saved += 1;
    if (last.ignored) ignored += 1;
  }
  if (mocked && saved === 0) {
    return res.status(403).json({ error: 'mock locations are not allowed', mocked });
  }
  if (att.zone !== zoneBefore) alerted = true;

  res.json({
    ...last, // latest zone / distance / warning
    processed: points.length,
    saved,
    ignored,
    ...(mocked && { mocked }),
    ...(invalid && invalid.length && { invalidIndexes: invalid }),
    ...(alerted && { alerted: true }),
  });
}

async function flagFakeGps(g, att) {
  if (!att.fakeGpsAlerted) {
    att.fakeGpsAlerted = true;
    await att.save();
    await notify.raiseAlert(g, 'FAKE_GPS', `${g.name}'s phone is reporting a mock/fake GPS location`, {
      attendanceId: att._id,
    });
  }
}

module.exports = { location };
