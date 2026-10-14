// Server-local date as YYYY-MM-DD (set TZ env var, e.g. TZ=Asia/Karachi)
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "HH:MM" -> minutes since midnight, or null if invalid
function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Minutes since midnight for a Date in server-local zone.
function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

// Shift-window check. Handles day shifts (08:00-20:00) and overnight
// shifts (22:00-06:00, where end <= start means "crosses midnight").
//
//   shift: { start: "HH:MM", end: "HH:MM" } | null/undefined
//   now: Date (defaults to now)
//   opts: { earlyAllowMin, endGraceMin }
//
// Returns { ok, reason, start, end, minsNow, earlyOpen, hardClose, overnight }
//   ok=true  -> now is inside [start-earlyAllow, end+grace] (shift "open")
//   ok=false -> reason is 'NO_SHIFT' | 'SHIFT_NOT_STARTED' | 'SHIFT_ENDED'
function shiftStatus(shift, now = new Date(), opts = {}) {
  const earlyAllow = Number(opts.earlyAllowMin ?? 0);
  const endGrace = Number(opts.endGraceMin ?? 0);
  const start = toMinutes(shift && shift.start);
  const end = shift && shift.end != null ? toMinutes(shift.end) : null;
  const minsNow = nowMinutes(now);
  if (start == null) return { ok: true, reason: null, start, end, minsNow, noShift: true };
  if (end == null) {
    // Open-ended shift: only an early gate applies.
    const earlyOpen = start - (Number.isFinite(earlyAllow) ? earlyAllow : 0);
    if (minsNow < earlyOpen) {
      return { ok: false, reason: 'SHIFT_NOT_STARTED', start, end, minsNow, earlyOpen, hardClose: null, overnight: false };
    }
    return { ok: true, reason: null, start, end, minsNow, earlyOpen, hardClose: null, overnight: false };
  }
  const overnight = end <= start;
  const earlyOpen = start - (Number.isFinite(earlyAllow) ? earlyAllow : 0);
  const grace = Number.isFinite(endGrace) ? endGrace : 0;
  if (!overnight) {
    // Day shift, e.g. 08:00-20:00 -> open in [earlyOpen, end+grace].
    if (minsNow < earlyOpen) {
      return { ok: false, reason: 'SHIFT_NOT_STARTED', start, end, minsNow, earlyOpen, hardClose: end + grace, overnight };
    }
    if (minsNow > end + grace) {
      return { ok: false, reason: 'SHIFT_ENDED', start, end, minsNow, earlyOpen, hardClose: end + grace, overnight };
    }
    return { ok: true, reason: null, start, end, minsNow, earlyOpen, hardClose: end + grace, overnight };
  }
  // Overnight shift, e.g. 22:00-06:00 -> open when minsNow >= earlyOpen
  // (evening side) OR minsNow <= end+grace (morning side). Closed only in
  // the gap (end+grace, earlyOpen), e.g. (06:00+grace, 22:00-early).
  const hardClose = end + grace; // on the morning side, may exceed 1440
  const inEvening = minsNow >= earlyOpen; // 21:30..23:59 side
  const inMorning = minsNow <= end + grace; // 00:00..06:00+grace side
  if (inEvening || inMorning) {
    return { ok: true, reason: null, start, end, minsNow, earlyOpen, hardClose, overnight };
  }
  // In the daytime gap: distinguish "before shift" vs "after shift" by
  // closeness so the app can show the right message.
  const reason = minsNow > end + grace && minsNow < earlyOpen
    ? (minsNow - (end + grace) < earlyOpen - minsNow ? 'SHIFT_ENDED' : 'SHIFT_NOT_STARTED')
    : 'SHIFT_ENDED';
  return { ok: false, reason, start, end, minsNow, earlyOpen, hardClose, overnight };
}

function fmtMinutes(m) {
  if (m == null) return null;
  const n = ((Math.round(m) % 1440) + 1440) % 1440;
  const p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(n / 60))}:${p(n % 60)}`;
}

module.exports = { localDate, toMinutes, nowMinutes, shiftStatus, fmtMinutes };
