// Locale-correct formatters per SPEC.md §11: Romanian-style DD-MM-YYYY dates,
// 24-hour HH:mm times, all timestamps displayed in Europe/Bucharest.
// See apps/restaurant/lib/format.js for the design notes.

export function formatDate(input) {
  if (!input) return '';
  const ymd = String(input).slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function partsTo(d, options) {
  const parts = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Europe/Bucharest' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return get;
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const get = partsTo(d, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

export function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const get = partsTo(d, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${get('hour')}:${get('minute')}`;
}
