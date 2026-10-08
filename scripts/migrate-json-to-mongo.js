// One-shot migration: old ./data/db.json (JSON-file store) -> MongoDB.
// Usage: MONGO_URI=mongodb://localhost:27017/guard-monitor node scripts/migrate-json-to-mongo.js [DATA_DIR]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cfg = require('../src/config');

const DATA_DIR = path.resolve(process.argv[2] || process.env.DATA_DIR || './data');
const FILE = path.join(DATA_DIR, 'db.json');

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log(`No legacy db at ${FILE}; nothing to migrate.`);
    process.exit(0);
  }
  const legacy = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  await mongoose.connect(cfg.MONGO_URI);
  console.log(`Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  const User = require('../src/models/User.model');
  const Site = require('../src/models/Site.model');
  const Guard = require('../src/models/Guard.model');
  const Attendance = require('../src/models/Attendance.model');
  const Alert = require('../src/models/Alert.model');
  const Location = require('../src/models/Location.model');

  const idMap = { users: new Map(), sites: new Map(), guards: new Map(), attendance: new Map() };
  const newId = () => new mongoose.Types.ObjectId();
  const mapId = (coll, old) => {
    if (!old) return null;
    if (!idMap[coll].has(old)) idMap[coll].set(old, newId());
    return idMap[coll].get(old);
  };

  // Sites (no refs)
  for (const s of legacy.sites || []) {
    const _id = mapId('sites', s.id);
    await Site.updateOne({ _id }, { $setOnInsert: { ...s, _id } }, { upsert: true });
  }
  // Guards (siteId ref)
  for (const g of legacy.guards || []) {
    const _id = mapId('guards', g.id);
    const siteId = mapId('sites', g.siteId);
    const { id, ...rest } = g;
    await Guard.updateOne({ _id }, { $setOnInsert: { ...rest, _id, siteId } }, { upsert: true });
  }
  // Users (guardId ref)
  for (const u of legacy.users || []) {
    if (await User.findOne({ username: u.username })) continue;
    const _id = mapId('users', u.id);
    const { id, guardId, ...rest } = u;
    await User.create({ ...rest, _id, guardId: guardId ? mapId('guards', guardId) : null });
  }
  // Attendance (guard + site refs)
  for (const a of legacy.attendance || []) {
    const _id = mapId('attendance', a.id);
    const { id, guardId, siteId, attendanceId, ...rest } = a;
    const violations = (a.violations || []).map((v) => {
      const { id: _vid, ...vr } = v;
      return vr;
    });
    await Attendance.updateOne(
      { _id },
      {
        $setOnInsert: {
          ...rest, _id, violations,
          guardId: mapId('guards', guardId),
          siteId: mapId('sites', siteId),
        },
      },
      { upsert: true }
    );
  }
  // Alerts
  for (const al of legacy.alerts || []) {
    const { id, guardId, siteId, attendanceId, ...rest } = al;
    await Alert.create({
      ...rest,
      guardId: guardId ? mapId('guards', guardId) : null,
      siteId: siteId ? mapId('sites', siteId) : null,
      attendanceId: attendanceId ? mapId('attendance', attendanceId) : null,
    });
  }
  // Locations
  const locs = (legacy.locations || []).map((l) => {
    const { attendanceId, guardId, ...rest } = l;
    return {
      ...rest,
      attendanceId: mapId('attendance', attendanceId),
      guardId: mapId('guards', guardId),
    };
  });
  if (locs.length) await Location.insertMany(locs, { ordered: false });

  console.log('Migration complete.');
  console.log(`  sites: ${(legacy.sites || []).length}, guards: ${(legacy.guards || []).length}, users: ${(legacy.users || []).length}, attendance: ${(legacy.attendance || []).length}, alerts: ${(legacy.alerts || []).length}, locations: ${locs.length}`);
  await mongoose.connection.close();
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
