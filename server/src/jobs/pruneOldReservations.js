// 30-day reservation pruning job (SPEC §3.2).
//
// pruneOldReservations(prisma, now) hard-deletes reservations whose
// calendar date is strictly more than 30 days before `now` AND whose
// status is terminal (COMPLETED / NO_SHOW / CANCELLED). It deliberately
// never touches:
//   - future or recent reservations (anything dated within the last 30
//     days, regardless of status);
//   - non-terminal statuses (CONFIRMED / AUTO_CONFIRMED / PENDING /
//     MODIFICATION_PENDING) — those should not exist in the deep past,
//     but the status filter makes the guard explicit rather than implied.
//
// The cutoff is computed at UTC-midnight of (today − 30 days). Since
// Reservation.date is stored as UTC-midnight of a Bucharest calendar
// date, `date < cutoff` means "calendar date is older than 30 days":
// a row dated exactly 30 days ago is kept (not "more than" 30 days).
//
// Idempotent: a same-day re-run finds the previous run already deleted
// the matching set, so the second call deletes 0 rows.
//
// Scheduled from server/src/index.js on its own 24h setInterval —
// kept separate from the minute-tick table-status loop in
// socket/handlers.js so a failure here cannot disrupt those jobs.

const RETENTION_DAYS = 30;
const TERMINAL_STATUSES = ['COMPLETED', 'NO_SHOW', 'CANCELLED'];

async function pruneOldReservations(prisma, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

  const result = await prisma.reservation.deleteMany({
    where: {
      date: { lt: cutoff },
      status: { in: TERMINAL_STATUSES },
    },
  });

  if (result.count > 0) {
    console.log(`[prune:reservations] deleted ${result.count} terminal reservation(s) older than ${RETENTION_DAYS}d (cutoff ${cutoff.toISOString().slice(0, 10)})`);
  }
  return { deleted: result.count, cutoff };
}

module.exports = { pruneOldReservations, RETENTION_DAYS, TERMINAL_STATUSES };
