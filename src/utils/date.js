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

module.exports = { localDate, toMinutes };
