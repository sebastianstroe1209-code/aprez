// Opening-hours / service-period time checks (SPEC §6.4, §9.2).
//
// Extracted Tier G commit 5b so the diner-facing GET /restaurants
// availability join can reuse the SAME open-window math the booking
// path uses, rather than re-deriving it (and drifting). Before G5b,
// `timeMinutesFitsOpenWindow` lived inline in reservation.routes.js;
// POST /reservations and the reservation-modify route both call it
// through here now.

// Minute-of-day range check for opening hours that handles
// cross-midnight close times. closeTime '00:00' represents midnight at
// the END of the service day (effectively 24:00); without this
// normalization a 20:00 reservation at a venue open 10:00 → 00:00 would
// 400 because raw 0 < 1200. End is inclusive (a booking exactly at
// closeTime is allowed; the reservation duration check elsewhere caps
// how late it can actually run).
function timeMinutesFitsOpenWindow(timeStr, openTimeStr, closeTimeStr) {
  const toMin = (s) => parseInt(s.split(':')[0]) * 60 + parseInt(s.split(':')[1]);
  const req = toMin(timeStr);
  const openStart = toMin(openTimeStr);
  let openEnd = toMin(closeTimeStr);
  if (openEnd <= openStart) openEnd += 24 * 60; // cross-midnight (e.g. 10:00 → 00:00 = 24:00)
  return req >= openStart && req <= openEnd;
}

// True iff `timeStr` falls inside at least one of the restaurant's
// service periods. An EMPTY period list means "no service-period
// constraint" → returns true (opening hours alone govern). Mirrors the
// /time-slots slot-generation rule: when a day has service periods,
// only times inside one of them are bookable. Each period is treated
// as its own open window so cross-midnight dinner periods
// (e.g. 18:00 → 00:00) normalize the same way opening hours do.
function timeWithinServicePeriods(timeStr, servicePeriods) {
  if (!Array.isArray(servicePeriods) || servicePeriods.length === 0) return true;
  return servicePeriods.some((sp) =>
    timeMinutesFitsOpenWindow(timeStr, sp.startTime, sp.endTime)
  );
}

module.exports = { timeMinutesFitsOpenWindow, timeWithinServicePeriods };
