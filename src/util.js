// Date/shift helpers live in utils/date (single source of truth);
// re-exported here so legacy `require('../util')` keeps working.
const dateUtils = require('./utils/date');

function localDate(d = new Date()) {
  return dateUtils.localDate(d);
}

// Validate coordinates coming from JSON or multipart forms
function readCoords(b) {
  if (!b || b.lat == null || b.lng == null || b.lat === '' || b.lng === '') return null;
  const lat = Number(b.lat), lng = Number(b.lng);
  const accuracy = b.accuracy == null || b.accuracy === '' ? 0 : Number(b.accuracy);
  if (![lat, lng, accuracy].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0) return null;
  return { lat, lng, accuracy, mocked: b.mocked === true || b.mocked === 'true' };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = {
  localDate,
  toMinutes: dateUtils.toMinutes,
  nowMinutes: dateUtils.nowMinutes,
  shiftStatus: dateUtils.shiftStatus,
  fmtMinutes: dateUtils.fmtMinutes,
  readCoords, distanceMeters,
};
