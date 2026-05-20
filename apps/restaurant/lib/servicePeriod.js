// Service-period time-window helper, shared by the Live floor plan and
// the Calendar (SPEC §6.3 / §6.4). Extracted from live/page.js in Tier H
// commit 2 so both pages filter by the exact same window logic — one
// source of truth, the precedent Tier G commit 5b set when it moved the
// availability helpers into lib/.

// True iff an "HH:MM" reservation time falls inside a service period's
// [startTime, endTime). An endTime at or before the start is treated as
// next-day midnight (24:00) so a cross-midnight window (e.g. 22:00–02:00)
// still matches. A null time or period means "no constraint" → true.
export function timeInPeriod(timeStr, period) {
  if (!timeStr || !period) return true
  const toMin = (s) => {
    const [h, m] = String(s).slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const start = toMin(period.startTime)
  let end = toMin(period.endTime)
  if (end <= start) end += 24 * 60
  let t = toMin(timeStr)
  if (t < start) t += 24 * 60
  return t >= start && t < end
}
