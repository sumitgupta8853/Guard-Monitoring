// Server-local date as YYYY-MM-DD (set the TZ env var to your timezone, e.g. TZ=Asia/Karachi)
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "HH:MM" -> minutes since midnight, or null if invalid
function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
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

module.exports = { localDate, toMinutes, readCoords, distanceMeters };
