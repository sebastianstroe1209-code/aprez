// C6 Phase 1 performance bench — measures p95 latency for the new and
// amended endpoints against the budgets in waiter_ux_strategy.md §8.
//
// 50 sequential calls per endpoint on the seeded La Mama restaurant.
// Sequential (not concurrent) — matches what a single waiter generates.
//
// Run: cd server && node .smoke/c6-phase1-bench.js
//
// Exits 1 if any endpoint exceeds budget; 0 otherwise. The output is what
// gets pasted into the Phase 1 commit summary.

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000';
const N = 50;

function pct(arr, p) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1);
  return sorted[idx];
}

async function bench(label, fn, budgetMs) {
  const samples = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  const p50 = pct(samples, 50);
  const p95 = pct(samples, 95);
  const p99 = pct(samples, 99);
  const ok = p95 <= budgetMs;
  const flag = ok ? 'OK  ' : 'FAIL';
  console.log(
    `${flag} ${label.padEnd(48)} p50=${p50.toFixed(0).padStart(4)}ms ` +
    `p95=${p95.toFixed(0).padStart(4)}ms p99=${p99.toFixed(0).padStart(4)}ms ` +
    `(budget ${budgetMs}ms)`
  );
  return { label, p50, p95, p99, budgetMs, ok };
}

async function call(path, opts = {}, token) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok && res.status !== 409 && res.status !== 404 && res.status !== 400) {
    throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json().catch(() => null);
}

async function main() {
  const prisma = new PrismaClient();

  // La Mama is the only restaurant with seeded tables. Big Ben exists as a
  // profile but has zero tables in the demo seed, which makes /layout/live
  // and /availability trivially fast (no rows to scan) and skews the bench.
  const restaurant = await prisma.restaurant.findFirst({
    where: { nameEn: 'La Mama' },
    select: { id: true, nameEn: true },
  });
  const staff = await prisma.restaurantStaff.findFirst({
    where: { restaurantId: restaurant.id },
    select: { id: true, restaurantId: true },
  });
  const freeTable = await prisma.restaurantTable.findFirst({
    where: { restaurantId: restaurant.id, status: 'FREE', isActive: true },
    select: { id: true, tableNumber: true, seatCount: true },
  });
  const reservation = await prisma.reservation.findFirst({
    where: { restaurantId: restaurant.id, status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] } },
    select: { id: true, tableId: true },
  });

  const token = jwt.sign(
    { id: staff.id, restaurantId: staff.restaurantId, role: 'restaurant' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  console.log(`\n=== C6 Phase 1 perf bench — restaurant "${restaurant.nameEn}", N=${N} sequential calls ===\n`);

  const results = [];
  // Pick a future Wednesday so La Mama's "10:00 - 00:00" Fri/Sat seed quirk
  // (interpreted by the diner-availability route as closes-at-midnight=0)
  // doesn't muddy the bench. C6 availability endpoint doesn't enforce
  // opening hours, but the diner-side one does — keep dates consistent
  // across both for repeatability.
  const futureDate = (() => {
    const d = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  results.push(await bench('GET  /api/restaurant/dashboard/summary',
    () => call('/api/restaurant/dashboard/summary', {}, token), 500));

  results.push(await bench('GET  /api/restaurant/layout/live',
    () => call('/api/restaurant/layout/live', {}, token), 300));

  results.push(await bench('GET  /api/restaurant/availability',
    () => call(`/api/restaurant/availability?date=${futureDate}&time=20:00&partySize=4`, {}, token), 200));

  results.push(await bench('GET  /api/restaurant/reservations (today)',
    () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
      return call(`/api/restaurant/reservations?date=${today}`, {}, token);
    }, 400));

  results.push(await bench('GET  /api/restaurant/reservations/pending',
    () => call('/api/restaurant/reservations/pending', {}, token), 400));

  // Mutation bench: hammering edit/no-show on the same reservation is fine
  // because the operations are idempotent on the bench's level (same body
  // each call, no state divergence).
  if (reservation) {
    results.push(await bench('PUT  /api/restaurant/reservations/:id (edit)',
      () => call(`/api/restaurant/reservations/${reservation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ specialRequests: 'bench-mark ping' }),
      }, token), 400));
  } else {
    console.log('SKIP PUT edit — no CONFIRMED/AUTO_CONFIRMED reservation available');
  }

  // Walk-in seat: alternate between seat (FREE->OCCUPIED) and status FREE
  // (OCCUPIED->FREE) so the bench is non-destructive. Each pair is one
  // walkin:created + walkin:ended cycle.
  if (freeTable) {
    let toggle = true;
    results.push(await bench('PUT  /api/restaurant/tables/:id/seat   (walkin alt)',
      async () => {
        if (toggle) {
          await call(`/api/restaurant/tables/${freeTable.id}/seat`, {
            method: 'PUT', body: JSON.stringify({ guestCount: 2 }),
          }, token);
        } else {
          await call(`/api/restaurant/tables/${freeTable.id}/status`, {
            method: 'PUT', body: JSON.stringify({ status: 'FREE' }),
          }, token);
        }
        toggle = !toggle;
      }, 400));
    // Reset to FREE just in case the toggle left it OCCUPIED.
    await call(`/api/restaurant/tables/${freeTable.id}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 'FREE' }),
    }, token);
    // Clean up walk-in activities created during the bench (50 rows is
    // chatty; this keeps the table_activities table tidy).
    await prisma.tableActivity.deleteMany({
      where: { tableId: freeTable.id, notes: null, kind: 'WALK_IN' },
    }).catch(() => {});
  }

  // PUT no-show smoke (single call — needs Awaiting Guest state which is
  // hard to fabricate non-destructively; skip in this bench).
  console.log('NOTE PUT /no-show not benched (requires Awaiting Guest reservation; covered by C4 smoke).');

  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(`FAIL ${failed.length}/${results.length} endpoint(s) over budget.`);
    process.exit(1);
  }
  console.log(`All ${results.length} endpoints within budget.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
