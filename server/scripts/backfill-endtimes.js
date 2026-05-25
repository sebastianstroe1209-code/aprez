// Tier K9 — backfill broken Reservation.endTime values.
//
// Root cause: scripts/seed-reminder-test.js shifted `time` without
// recomputing `endTime`, so the DB carries rows like:
//   id=1b1a69eb… time=00:29 endTime=21:00 (expected 02:29)
//   id=b7ef7774… time=01:11 endTime=15:30 (expected 03:11)
//   id=f0bc8a6c… time=23:42 endTime=21:00 (expected 01:42)
//
// The seed script is fixed (K9 commit) so new bad rows won't appear.
// This backfill repairs what's already in DB.
//
// Algorithm (per SPEC §9.1, K9 contract):
//   endMin = (startHour*60 + startMin + restaurant.reservationDurationMin)
//   newEndTime = `${String(Math.floor(endMin/60) % 24).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`
//
// Cross-midnight rows are CORRECT when endTime < time (e.g. time=22:00,
// dur=120 → endTime=00:00). The check is not "endTime < time" but
// "endTime != recomputed".
//
// Idempotent — running on a clean DB updates zero rows.
//
// Usage (from server/):  node scripts/backfill-endtimes.js
// Dry-run mode:          node scripts/backfill-endtimes.js --dry

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry');

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  return (
    String(Math.floor(totalMin / 60) % 24).padStart(2, '0') +
    ':' +
    String(totalMin % 60).padStart(2, '0')
  );
}

async function main() {
  console.log(`--- K9 endTime backfill ${DRY_RUN ? '(dry-run)' : ''}---`);

  const rows = await prisma.reservation.findMany({
    select: {
      id: true,
      time: true,
      endTime: true,
      status: true,
      date: true,
      restaurant: { select: { reservationDurationMin: true } },
    },
  });
  console.log(`[scan] ${rows.length} reservations to inspect.`);

  const bad = [];
  for (const r of rows) {
    if (!r.time) continue;
    const dur = r.restaurant?.reservationDurationMin || 120;
    const expected = addMinutes(r.time, dur);
    if (r.endTime !== expected) {
      bad.push({ id: r.id, time: r.time, endTime: r.endTime, expected, status: r.status, date: r.date.toISOString().slice(0, 10) });
    }
  }

  console.log(`[scan] ${bad.length} rows mismatch the current restaurant.reservationDurationMin.`);
  for (const b of bad) {
    console.log(`  ${b.id}  date=${b.date} status=${b.status}  time=${b.time}  endTime=${b.endTime} → ${b.expected}`);
  }

  if (bad.length === 0) {
    console.log('[done] nothing to fix.');
    return;
  }

  if (DRY_RUN) {
    console.log('[dry] would update the rows above. Re-run without --dry to apply.');
    return;
  }

  // Update in one transaction so a mid-flight crash doesn't leave the
  // DB half-fixed.
  const updates = bad.map((b) =>
    prisma.reservation.update({
      where: { id: b.id },
      data: { endTime: b.expected },
    })
  );
  await prisma.$transaction(updates);
  console.log(`[fix] ${bad.length} rows updated.`);
}

main()
  .catch((e) => {
    console.error('!!! backfill failed:');
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
