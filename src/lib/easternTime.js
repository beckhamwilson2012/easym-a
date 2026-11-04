// A moment in US Eastern market time, e.g. "Nov 3, 2026, 4:00 PM ET". Null if it can't be read.
export function fmtEastern(when) {
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  if (isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${text} ET`;
}

// A calendar date as filed or traded, e.g. "2026-11-02" → "Nov 2, 2026". It stays on that date in any time zone.
export function fmtCalendarDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}
