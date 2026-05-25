// Tier K9 — endTime backfill + addMinutes math regression.
//
// Pre-K9 audit saw rows with endTime nowhere near `addMinutes(time, dur)`:
//   id=1b1a69eb… time=00:29 endTime=21:00  (expected 02:29)
//   id=f0bc8a6c… time=23:42 endTime=21:00  (expected 01:42)
//
// Root cause: scripts/seed-reminder-test.js shifted `time` without
// updating `endTime`. Fixed (K9 commit) + scripts/backfill-endtimes.js
// repairs existing rows.
//
//   [a] addMinutes wraps cross-midnight correctly:
//       (22:00, 120) → "00:00",  (23:42, 120) → "01:42".
//   [b] Live DB has zero rows where endTime != recomputed (post-backfill).
//   [c] Backfill script is idempotent — running on a clean DB updates 0.
//   [d] Backfill recovers from a freshly-seeded bad row:
//        - manually break demo's reservation: set endTime="03:03"
//        - run backfill
//        - assert endTime is back to the recomputed value.
//
// Requires the live Railway DB connection. Mutates and restores the
// demo user's most recent CONFIRMED/AUTO_CONFIRMED reservation as part
// of [d]; the restore happens whether the smoke passes or fails.

const path = require('path');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKFILL_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'backfill-endtimes.js');

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

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
  console.log('[a] addMinutes math regression');
  expect(addMinutes('22:00', 120) === '00:00', `addMinutes('22:00',120) === '00:00' (got '${addMinutes('22:00', 120)}')`);
  expect(addMinutes('23:42', 120) === '01:42', `addMinutes('23:42',120) === '01:42' (got '${addMinutes('23:42', 120)}')`);
  expect(addMinutes('00:29', 120) === '02:29', `addMinutes('00:29',120) === '02:29' (got '${addMinutes('00:29', 120)}')`);
  expect(addMinutes('19:00', 120) === '21:00', `addMinutes('19:00',120) === '21:00' (got '${addMinutes('19:00', 120)}')`);

  console.log('\n[b] live DB has zero rows where endTime != recomputed');
  const rows = await prisma.reservation.findMany({
    select: { id: true, time: true, endTime: true, restaurant: { select: { reservationDurationMin: true } } },
  });
  const mismatched = rows.filter((r) => {
    if (!r.time) return false;
    const dur = r.restaurant?.reservationDurationMin || 120;
    return r.endTime !== addMinutes(r.time, dur);
  });
  expect(mismatched.length === 0, `mismatched rows = 0 (got ${mismatched.length}: ${mismatched.slice(0, 3).map((r) => r.id).join(',')})`);

  console.log('\n[c] backfill script is idempotent on a clean DB');
  const cleanOut = execFileSync('node', [BACKFILL_SCRIPT, '--dry'], { encoding: 'utf8' });
  expect(/\[scan\] 0 rows mismatch/.test(cleanOut), `dry run reports 0 rows to fix (got: ${cleanOut.split('\n').slice(1, 4).join(' | ')})`);

  console.log('\n[d] backfill recovers from a freshly-seeded bad row');
  // Find any reservation owned by demo user that we can safely mangle/restore.
  const demo = await prisma.user.findUnique({ where: { email: 'demo@aprez.ro' }, select: { id: true } });
  expect(!!demo?.id, `demo user found`);
  const target = await prisma.reservation.findFirst({
    where: { userId: demo.id },
    select: { id: true, time: true, endTime: true, restaurant: { select: { reservationDurationMin: true } } },
    orderBy: { createdAt: 'desc' },
  });
  expect(!!target, `at least one reservation exists for demo`);

  if (target) {
    const originalEndTime = target.endTime;
    const dur = target.restaurant?.reservationDurationMin || 120;
    const expectedEnd = addMinutes(target.time, dur);
    const brokenEnd = '03:03'; // deliberately wrong
    try {
      await prisma.reservation.update({
        where: { id: target.id },
        data: { endTime: brokenEnd },
      });
      const out = execFileSync('node', [BACKFILL_SCRIPT], { encoding: 'utf8' });
      expect(/\[fix\] 1 rows updated\.|\[fix\] [2-9]\d* rows updated\./.test(out),
        `backfill reports updating ≥1 row (out tail: ${out.split('\n').slice(-3).join(' | ')})`);
      const after = await prisma.reservation.findUnique({ where: { id: target.id }, select: { endTime: true } });
      expect(after.endTime === expectedEnd, `endTime restored to '${expectedEnd}' (got '${after.endTime}')`);
    } finally {
      // Restore to whatever was originally stored (which equals expectedEnd
      // after [b] passed, but be defensive in case [b] was failing already).
      await prisma.reservation.update({
        where: { id: target.id },
        data: { endTime: originalEndTime },
      }).catch(() => {});
    }
  }

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Smoke crashed:', err);
  process.exitCode = 1;
  await prisma.$disconnect();
});
