// Validate coordinates coming from JSON or multipart forms
function readCoords(b) {
  if (!b || b.lat == null || b.lng == null || b.lat === '' || b.lng === '') return null;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const accuracy = b.accuracy == null || b.accuracy === '' ? 0 : Number(b.accuracy);
  if (![lat, lng, accuracy].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0) return null;
  return { lat, lng, accuracy, mocked: b.mocked === true || b.mocked === 'true' };
}

const validCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

module.exports = { readCoords, validCoord };
