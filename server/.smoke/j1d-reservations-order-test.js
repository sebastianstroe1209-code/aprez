// Tier J launch-fix 1d — diner "my reservations" ordering (SPEC §5.4).
//
// Mobile QA found GET /api/reservations/mine returned far-future
// bookings at the top of the diner's list (it sorted `date desc`).
// J1d makes the canonical order: closest UPCOMING first (date+time
// ascending), then PAST (most-recent first).
//
//   [a] GET /reservations/mine → 200, { reservations: [...] }.
//   [b] reservations[0] is an upcoming reservation (the closest one) —
//       its sort key ≤ every other upcoming row.
//   [c] the upcoming block is date+time ASCENDING; the past block that
//       follows it is DESCENDING; no upcoming row appears after a past
//       row.
//   [d] against 4 seeded rows (past −5d, near +3d, mid +25d, far +60d):
//       index(+3d) < index(+25d) < index(+60d) < index(−5d).
//
// Requires the backend on :4000. Seeds 4 reservations on the demo diner
// at La Mama and deletes them at the end.

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const LA_MAMA = 'demo-restaurant-001';

const TERMINAL = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);
const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
const dstr = (d) => String(d).slice(0, 10);
const sortKey = (r) => `${dstr(r.date)}T${r.time || ''}`;
const isUpcoming = (r) => dstr(r.date) >= todayStr && !TERMINAL.has(r.status);
const isoDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function http(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function main() {
  const login = await http('POST', '/auth/login', null, { email: 'demo@aprez.ro', password: 'user123' });
  const token = login.body?.token;
  const userId = login.body?.user?.id;
  expect(!!token && !!userId, `diner login → token + userId (${userId})`);

  console.log('\n[seed] 4 reservations — past −5d, near +3d, mid +25d, far +60d');
  const seed = async (days) => prisma.reservation.create({
    data: {
      userId, restaurantId: LA_MAMA,
      date: new Date(`${isoDate(days)}T00:00:00.000Z`),
      time: '19:00', endTime: '21:00', partySize: 2,
      status: 'CONFIRMED', source: 'APP',
    },
    select: { id: true },
  });
  const past = await seed(-5);
  const near = await seed(3);
  const mid = await seed(25);
  const far = await seed(60);

  console.log('\n[a] GET /reservations/mine');
  const res = await http('GET', '/reservations/mine', token);
  expect(res.status === 200, `status=200 (got ${res.status})`);
  const list = res.body?.reservations;
  expect(Array.isArray(list) && list.length >= 4, `reservations[] returned (length ${list?.length})`);

  const up = list.filter(isUpcoming);
  const pastRows = list.filter((r) => !isUpcoming(r));

  console.log('\n[b] reservations[0] is the closest upcoming');
  expect(up.length > 0 && isUpcoming(list[0]), 'reservations[0] is an upcoming reservation');
  const minUpKey = up.reduce((m, r) => (sortKey(r) < m ? sortKey(r) : m), sortKey(up[0]));
  expect(sortKey(list[0]) === minUpKey, `reservations[0] has the earliest upcoming date+time`);

  console.log('\n[c] upcoming block ascending, then past block descending');
  // first up.length entries are exactly the upcoming rows, in order
  let blockOk = true;
  for (let i = 0; i < up.length; i++) if (!isUpcoming(list[i])) blockOk = false;
  for (let i = up.length; i < list.length; i++) if (isUpcoming(list[i])) blockOk = false;
  expect(blockOk, 'all upcoming rows precede all past rows');
  let upAsc = true;
  for (let i = 1; i < up.length; i++) if (sortKey(up[i - 1]) > sortKey(up[i])) upAsc = false;
  expect(upAsc, 'upcoming block is date+time ascending');
  let pastDesc = true;
  for (let i = 1; i < pastRows.length; i++) if (sortKey(pastRows[i - 1]) < sortKey(pastRows[i])) pastDesc = false;
  expect(pastDesc, 'past block is date+time descending');

  console.log('\n[d] seeded rows ordered near < mid < far < past');
  const idx = (id) => list.findIndex((r) => r.id === id);
  const iNear = idx(near.id), iMid = idx(mid.id), iFar = idx(far.id), iPast = idx(past.id);
  expect(iNear >= 0 && iMid >= 0 && iFar >= 0 && iPast >= 0, 'all 4 seeded rows present');
  expect(iNear < iMid && iMid < iFar, `upcoming seeds ascending (near=${iNear} < mid=${iMid} < far=${iFar})`);
  expect(iFar < iPast, `past seed (−5d, idx ${iPast}) sits after all upcoming seeds`);

  console.log('\n[cleanup]');
  for (const id of [past.id, near.id, mid.id, far.id]) {
    await prisma.reservation.delete({ where: { id } }).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
