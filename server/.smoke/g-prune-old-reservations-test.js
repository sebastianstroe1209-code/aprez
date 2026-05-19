// Tier G commit 2 — 30-day reservation pruning smoke (SPEC §3.2).
//
//   (a) COMPLETED reservation dated 31 days ago  → pruned (row gone).
//   (b) AUTO_CONFIRMED reservation 31 days ago   → kept (non-terminal status).
//   (c) COMPLETED reservation dated 29 days ago  → kept (inside the 30-day window).
//   (d) Idempotency: a second prune run deletes 0 rows.
//
// Calls the pruneOldReservations job function directly — no HTTP, no
// running backend required. Note the prune is a global operation: it
// removes ALL terminal reservations older than 30 days, so the count it
// returns may exceed the one seeded row if the DB holds other old
// terminal history. Assertions key on the three seeded rows by id, so
// they hold regardless.

const { PrismaClient } = require('@prisma/client');
const { pruneOldReservations } = require('../src/jobs/pruneOldReservations');

const prisma = new PrismaClient();
const TAG = '[smoke-g-prune]';

function utcMidnight(offsetDays) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function main() {
  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  if (!restaurant) throw new Error('seed restaurant (lamama) not found — run db:seed');
  const rid = restaurant.id;
  console.log(`Smoke target restaurant: ${restaurant.nameEn} (${rid})`);

  // Clear any leftover [smoke-g-prune] rows from a previous run.
  await prisma.reservation.deleteMany({ where: { restaurantId: rid, guestName: TAG } });

  console.log('\n[seed] 3 reservations: COMPLETED@-31d, AUTO_CONFIRMED@-31d, COMPLETED@-29d');
  const mk = (status, dayOffset) =>
    prisma.reservation.create({
      data: {
        restaurantId: rid,
        guestName: TAG,
        guestPhone: '+40700000000',
        date: utcMidnight(dayOffset),
        time: '19:00',
        endTime: '21:00',
        partySize: 2,
        status,
        source: 'MANUAL',
      },
    });
  const r1 = await mk('COMPLETED', -31);      // (a) should be pruned
  const r2 = await mk('AUTO_CONFIRMED', -31); // (b) should survive — non-terminal
  const r3 = await mk('COMPLETED', -29);      // (c) should survive — inside window

  const before = await prisma.reservation.count({
    where: { date: { lt: utcMidnight(-30) }, status: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED'] } },
  });
  console.log(`  (terminal reservations older than 30d in DB before prune: ${before})`);

  console.log('\n[run] pruneOldReservations()');
  const res1 = await pruneOldReservations(prisma, new Date());
  console.log(`  prune deleted ${res1.deleted} row(s)`);

  const r1After = await prisma.reservation.findUnique({ where: { id: r1.id } });
  const r2After = await prisma.reservation.findUnique({ where: { id: r2.id } });
  const r3After = await prisma.reservation.findUnique({ where: { id: r3.id } });
  expect(r1After === null, '(a) COMPLETED @-31d pruned (row gone)');
  expect(r2After !== null, '(b) AUTO_CONFIRMED @-31d kept (non-terminal status)');
  expect(r3After !== null, '(c) COMPLETED @-29d kept (inside 30-day window)');
  expect(res1.deleted >= 1, `(a) prune reported >=1 deletion (got ${res1.deleted})`);

  console.log('\n[run] pruneOldReservations() again — idempotency');
  const res2 = await pruneOldReservations(prisma, new Date());
  expect(res2.deleted === 0, `(d) second run is a no-op (deleted ${res2.deleted})`);

  console.log('\n[cleanup] remove the two surviving smoke rows');
  await prisma.reservation.deleteMany({ where: { id: { in: [r2.id, r3.id] } } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
