const cfg = require('../config');
const { fileUrl } = require('../utils/fileUrl');

// STRICT hourly proof-of-presence: wall-clock top-of-hour slots.
// Slot N (1-based) is due at the Nth top-of-hour strictly after checkInAt.
// The 11:00 photo is accepted ONLY inside [10:55, 11:05] — not before, not after.
// A closed window with no photo is a permanent miss (checkout stays allowed).

function earlyMs() {
  const m = Number(cfg.HOURLY_EARLY_MIN);
  return (Number.isFinite(m) ? Math.max(0, m) : 5) * 60000;
}

function lateMs() {
  const m = Number(cfg.HOURLY_LATE_MIN);
  return (Number.isFinite(m) ? Math.max(0, m) : 5) * 60000;
}

// Keep old names working: interval fixed 1h, "grace" = late side of window.
function intervalMs() { return 3600000; }
function graceMs() { return lateMs(); }

function checkInMs(att) {
  const ms = Date.parse(att.checkInAt);
  return Number.isFinite(ms) ? ms : null;
}

// First slot due: first top-of-hour strictly after check-in.
// check-in 10:13 -> slot 1 due 11:00. check-in exactly 10:00 -> slot 1 due 11:00.
// NOTE: setMinutes uses the server's local zone. Run the server with TZ=Asia/Kolkata.
function firstDueMs(att) {
  const start = checkInMs(att);
  if (start == null) return null;
  const d = new Date(start);
  d.setMinutes(0, 0, 0);
  let due = d.getTime() + 3600000;
  if (due <= start) due += 3600000;
  return due;
}

function dueAtMs(att, slot) {
  const first = firstDueMs(att);
  if (first == null || !(slot >= 1)) return null;
  return first + (slot - 1) * 3600000;
}

// Acceptance window for a slot: [due - early, due + late].
function windowOf(att, slot) {
  const due = dueAtMs(att, slot);
  if (due == null) return null;
  return { slot, dueAt: due, openAt: due - earlyMs(), closeAt: due + lateMs() };
}

// How many slots exist (due <= now)? 0 means nothing due yet.
function dueSlot(att, nowMs = Date.now()) {
  const first = firstDueMs(att);
  if (first == null || nowMs < first) return 0;
  return Math.floor((nowMs - first) / 3600000) + 1;
}

// Slot whose window contains nowMs (uploadable right now), else null.
function activeSlot(att, nowMs = Date.now()) {
  const first = firstDueMs(att);
  if (first == null) return null;
  const n = Math.floor((nowMs - lateMs() - first) / 3600000) + 1;
  for (const s of [n, n + 1]) {
    if (s < 1) continue;
    const w = windowOf(att, s);
    if (nowMs >= w.openAt && nowMs <= w.closeAt) return s;
  }
  return null;
}

// FIXED: first slot whose window has NOT closed yet (active slot if its window is open,
// otherwise the upcoming one). Previously this returned the last CLOSED slot (off by one).
function nextOpenSlot(att, nowMs = Date.now()) {
  const first = firstDueMs(att);
  if (first == null) return null;
  const lastClosed = Math.floor((nowMs - lateMs() - first) / 3600000) + 1; // may be <= 0
  return Math.max(1, lastClosed + 1);
}

function uploadedSlots(att) {
  const set = new Set();
  for (const h of att.hourlyPhotos || []) set.add(h.slotIndex);
  return set;
}

// Server TZ label used for all slot math (slot = top-of-hour in THIS zone).
// Guards/phones must be in the same zone; ISO strings are UTC, so every
// timestamp is ALSO exposed as a pre-formatted *Local field in this zone —
// apps must display *Local/message, never render raw ISO directly.
function tzName() {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
}
const fmtLocalT = (ms) => new Date(ms).toLocaleTimeString('en-IN', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tzName(),
});
const fmtLocalFull = (ms) => new Date(ms).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tzName(),
});

// All message text now uses the same zone-aware formatter.
const fmtT = fmtLocalT;
const fmtW = (w) => `${fmtLocalT(w.openAt)}–${fmtLocalT(w.closeAt)}`;

const localWindow = (w) => ({
  slot: w.slot,
  openAt: new Date(w.openAt).toISOString(),
  dueAt: new Date(w.dueAt).toISOString(),
  closeAt: new Date(w.closeAt).toISOString(),
  openAtLocal: fmtLocalT(w.openAt),
  dueAtLocal: fmtLocalT(w.dueAt),
  closeAtLocal: fmtLocalT(w.closeAt),
  label: `${fmtLocalT(w.openAt)}–${fmtLocalT(w.closeAt)}`,
});

// Full status for guard app banner + admin badges.
function hourlyStatus(att, nowMs = Date.now()) {
  const first = firstDueMs(att);
  if (first == null) return null;
  const done = uploadedSlots(att);
  const endMs = att.checkOutAt ? Date.parse(att.checkOutAt) : nowMs;
  const horizon = Number.isFinite(endMs) ? endMs : nowMs;
  // Expected = slots whose window CLOSED by horizon (permanent record).
  let expected = 0;
  for (let s = 1; s <= 1000; s += 1) {
    const w = windowOf(att, s);
    if (horizon < w.closeAt) break;
    expected = s;
  }
  let missed = 0;
  for (let s = 1; s <= expected; s += 1) {
    if (!done.has(s)) missed += 1;
  }
  const uploaded = (att.hourlyPhotos || []).length;
  const current = att.checkOutAt ? null : activeSlot(att, nowMs); // time-based: window contains now
  const currentDone = current != null && done.has(current);
  // Uploadable RIGHT NOW: window open AND not yet uploaded. Null after upload.
  const active = current != null && !currentDone ? current : null;
  const lastUpload = (att.hourlyPhotos || []).slice().sort((a, b) => (b.slotIndex || 0) - (a.slotIndex || 0))[0] || null;

  // FIXED: next slot = first not-yet-closed slot that has NOT been uploaded.
  // Single source of truth for next* fields AND the message.
  let upcoming = nextOpenSlot(att, nowMs);
  while (done.has(upcoming) && upcoming < 1000) upcoming += 1;
  const upcomingW = windowOf(att, upcoming);
  const overdue = active != null && nowMs > windowOf(att, active).dueAt;

  let message;
  if (att.checkOutAt) {
    message = `Hourly photos: ${uploaded}/${expected} uploaded this shift${missed ? ` (${missed} missed)` : ''}`;
  } else if (active != null) {
    const w = windowOf(att, active);
    message = nowMs <= w.dueAt
      ? `Hourly photo #${active} window OPEN now (${fmtW(w)}) — upload your photo! Upload only within the slot time.`
      : `Hourly photo #${active} CLOSING at ${fmtT(w.closeAt)} — upload NOW! Upload only within the slot time.`;
  } else if (current != null && currentDone) {
    const atLocal = lastUpload && lastUpload.at
      ? new Date(lastUpload.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tzName() })
      : null;
    message = `Hourly photo #${current} received${atLocal ? ` at ${atLocal}` : ''} ✅ — next window ${fmtLocalT(upcomingW.openAt)}–${fmtLocalT(upcomingW.closeAt)}. Upload only within the slot time.`;
  } else {
    message = `Hourly photo #${upcoming} window ${fmtLocalT(upcomingW.openAt)}–${fmtLocalT(upcomingW.closeAt)} — upload only within the slot time (not before, not after).`;
  }

  const activeW = active != null ? windowOf(att, active) : null;
  return {
    strict: true,
    tz: tzName(),
    earlyMin: earlyMs() / 60000,
    lateMin: lateMs() / 60000,
    uploaded,
    expected,
    missed,
    currentSlot: current, // window contains now (even if already uploaded)
    activeSlot: active, // uploadable now; null after upload => hide upload button
    uploadedActive: current != null && currentDone,
    lastUploadAt: lastUpload ? lastUpload.at : null,
    lastUploadSlot: lastUpload ? lastUpload.slotIndex : null,
    activeWindow: activeW ? localWindow(activeW) : null,
    nextSlot: upcoming,
    nextOpenAt: new Date(upcomingW.openAt).toISOString(),
    nextDueAt: new Date(upcomingW.dueAt).toISOString(),
    nextCloseAt: new Date(upcomingW.closeAt).toISOString(),
    nextOpenAtLocal: fmtLocalT(upcomingW.openAt),
    nextDueAtLocal: fmtLocalT(upcomingW.dueAt),
    nextCloseAtLocal: fmtLocalT(upcomingW.closeAt),
    nextWindowLabel: `${fmtLocalT(upcomingW.openAt)}–${fmtLocalT(upcomingW.closeAt)}`,
    nextWindowFull: `${fmtLocalFull(upcomingW.openAt)} – ${fmtLocalFull(upcomingW.closeAt)} (${tzName()})`,
    overdue,
    message,
  };
}

function withHourlyPhotos(attJson) {
  const photos = (attJson.hourlyPhotos || []).map((h) => ({
    ...h,
    photoUrl: fileUrl('attendance', h.photo),
  }));
  return { ...attJson, hourlyPhotos: photos, hourly: hourlyStatus(attJson) };
}

module.exports = {
  earlyMs, lateMs, intervalMs, graceMs, checkInMs, firstDueMs,
  dueAtMs, windowOf, dueSlot, activeSlot, nextOpenSlot,
  uploadedSlots, hourlyStatus, withHourlyPhotos,
  fmtLocalT, fmtLocalFull, tzName,
};