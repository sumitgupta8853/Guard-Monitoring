// Validate coordinates coming from JSON or multipart forms
function readCoords(b) {
  if (!b || b.lat == null || b.lng == null || b.lat === '' || b.lng === '') return null;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const accuracy = b.accuracy == null || b.accuracy === '' ? 0 : Number(b.accuracy);
  if (![lat, lng, accuracy].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0) return null;
  return {
    lat, lng, accuracy,
    mocked: b.mocked === true || b.mocked === 'true',
    at: parseTime(b.at ?? b.time ?? b.timestamp),
  };
}

// Parse a client-supplied timestamp (ISO string, epoch ms, or epoch s).
// Returns ms-since-epoch or null when missing/unusable.
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v; // epoch seconds -> ms
    const now = Date.now();
    if (ms > now + 5 * 60 * 1000) return null; // reject far-future stamps
    if (ms < now - 48 * 3600 * 1000) return null; // reject >48h old
    return ms;
  }
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  const now = Date.now();
  if (ms > now + 5 * 60 * 1000) return null;
  if (ms < now - 48 * 3600 * 1000) return null;
  return ms;
}

// Normalize a batched upload: { points: [...] } (alias: locations).
// Returns { points } or { error }. Caller caps length via maxPoints.
function readBatch(b, maxPoints = 200) {
  if (!b || !Array.isArray(b.points ?? b.locations)) return null; // not a batch
  const raw = b.points ?? b.locations;
  if (raw.length === 0) return { error: 'points must not be empty' };
  if (raw.length > maxPoints) return { error: `too many points (max ${maxPoints})` };
  const points = [];
  const invalid = [];
  raw.forEach((p, i) => {
    const c = readCoords(p);
    if (!c) { invalid.push(i); return; }
    points.push(c);
  });
  if (points.length === 0) return { error: 'no valid points in batch' };
  // Replay oldest-first so violation timestamps and outsideCount are correct.
  points.sort((a, b2) => (a.at ?? 0) - (b2.at ?? 0));
  return { points, invalid };
}

const validCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

module.exports = { readCoords, readBatch, validCoord };
