// Tier G commit 2 — auto-confirm picker smoke (SPEC §9.3).
//
// Exercises the real POST /api/reservations auto-confirm path against a
// throwaway restaurant whose entire table set is seeded here, so the
// restaurant-wide picker query is fully deterministic.
//
//   (a) Exact-match preference: party of 3 with one free 3-seat table
//       and one free 5-seat table → auto-confirms onto the 3-seat one.
//   (b) Fall-through to PENDING: party of 2 when every free table is
//       larger than the party → reservation stays PENDING (never
//       auto-confirms onto an over-capacity table).
//   (c) Most-free-neighbors tiebreak: party of 4 with two free 4-seat
//       tables, one with 3 free neighbors and one with 1 → auto-confirms
//       onto the 3-neighbour table.
//
// Requires the backend running on :4000. Seeds + tears down a
// `[smoke-g-picker]` restaurant (cascades sections/tables/openingHours;
// reservations + notifications are deleted first since their FK is RESTRICT).

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const TAG = '[smoke-g-picker]';

function isoDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

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

async function wipeFixture() {
  const old = await prisma.restaurant.findFirst({ where: { nameEn: TAG }, include: { tables: { select: { id: true } } } });
  if (!old) return;
  const tids = old.tables.map((t) => t.id);
  if (tids.length) await prisma.tableMove.deleteMany({ where: { tableId: { in: tids } } });
  await prisma.notification.deleteMany({ where: { restaurantId: old.id } });
  await prisma.reservation.deleteMany({ where: { restaurantId: old.id } });
  await prisma.restaurant.delete({ where: { id: old.id } }).catch(() => {});
}

async function main() {
  console.log('[baseline] wipe prior [smoke-g-picker] fixture');
  await wipeFixture();

  // Throwaway restaurant — always-open every weekday so any future date books.
  console.log('[fixture] create restaurant + opening hours + section + 8 tables');
  const restaurant = await prisma.restaurant.create({
    data: {
      nameRo: TAG, nameEn: TAG,
      cuisineTypes: ['Romanian'],
      address: 'Smoke fixture — not a real venue',
      latitude: 44.43, longitude: 26.10,
      phone: '+40700000000',
      openingHours: {
        create: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          dayOfWeek: d, isOpen: true, openTime: '00:00', closeTime: '23:59',
        })),
      },
    },
  });
  const rid = restaurant.id;

  const section = await prisma.tableSection.create({
    data: { restaurantId: rid, nameRo: TAG, nameEn: TAG, gridRows: 6, gridColumns: 5 },
  });
  const mk = (number, seats, row, col) =>
    prisma.restaurantTable.create({
      data: { sectionId: section.id, restaurantId: rid, tableNumber: number, seatCount: seats, gridRow: row, gridCol: col },
    });
  // Layout (rows × cols):
  //   T-EXACT(3) @ (0,0)   T-BIG(5) @ (0,2)
  //   T-HUB(4)   @ (2,3) with free neighbors N1(1,3) N2(3,3) N3(2,2) — (2,4) empty → 3 neighbors
  //   T-CORNER(4)@ (5,0) with free neighbor   N4(4,0)               — (5,1) empty → 1 neighbor
  // Neighbor tables are seatCount 1 so they never become exact-match
  // candidates for the party sizes booked below.
  const [tExact, tBig, tHub, tCorner, n1, n2, n3, n4] = await Promise.all([
    mk('G-EXACT', 3, 0, 0),
    mk('G-BIG', 5, 0, 2),
    mk('G-HUB', 4, 2, 3),
    mk('G-CORNER', 4, 5, 0),
    mk('G-N1', 1, 1, 3),
    mk('G-N2', 1, 3, 3),
    mk('G-N3', 1, 2, 2),
    mk('G-N4', 1, 4, 0),
  ]);

  const login = await http('POST', '/auth/login', null, { email: 'demo@aprez.ro', password: 'user123' });
  const token = login.body?.token;
  expect(!!token, 'diner login → token');

  // The POST /reservations response select doesn't expose tableId, so
  // the assigned table is read back from the DB by the returned id.
  const reload = (id) =>
    id ? prisma.reservation.findUnique({ where: { id }, select: { status: true, tableId: true } }) : null;

  console.log('\n[a] Exact-match preference: party 3, free 3-seat + free 5-seat');
  const a = await http('POST', '/reservations', token, { restaurantId: rid, date: isoDate(3), time: '19:00', partySize: 3 });
  expect(a.status === 201, `create status=201 (got ${a.status})`);
  const aRow = await reload(a.body?.id);
  expect(aRow?.status === 'AUTO_CONFIRMED', `status=AUTO_CONFIRMED (got ${aRow?.status})`);
  expect(aRow?.tableId === tExact.id, 'auto-confirmed onto the exact-match 3-seat table');

  console.log('\n[b] Fall-through to PENDING: party 2, every free table is larger');
  const b = await http('POST', '/reservations', token, { restaurantId: rid, date: isoDate(4), time: '19:00', partySize: 2 });
  expect(b.status === 201, `create status=201 (got ${b.status})`);
  const bRow = await reload(b.body?.id);
  expect(bRow?.status === 'PENDING', `status=PENDING — not auto-confirmed onto an over-capacity table (got ${bRow?.status})`);
  expect(bRow?.tableId == null, 'no table assigned (tableId null)');

  console.log('\n[c] Tiebreak: party 4, two 4-seat tables — 3 free neighbors vs 1');
  const c = await http('POST', '/reservations', token, { restaurantId: rid, date: isoDate(5), time: '19:00', partySize: 4 });
  expect(c.status === 201, `create status=201 (got ${c.status})`);
  const cRow = await reload(c.body?.id);
  expect(cRow?.status === 'AUTO_CONFIRMED', `status=AUTO_CONFIRMED (got ${cRow?.status})`);
  expect(cRow?.tableId === tHub.id, 'tiebreak picked the table with the most free neighbors (G-HUB)');
  expect(cRow?.tableId !== tCorner.id, 'did NOT pick the 1-neighbor table (G-CORNER)');

  console.log('\n[cleanup]');
  await wipeFixture();

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
