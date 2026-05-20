// Tier J launch-fix 1a — diner special-requests round-trip (SPEC §5.3).
//
// The mobile BookReservationScreen now collects an optional free-text
// "Special requests" note and sends it on POST /api/reservations. This
// smoke proves the end-to-end data contract that lights up the staff-
// side ✦ badge + popup body field (already shipped in Tier C6):
//
//   [a] POST /reservations with specialRequests → 201; the response and
//       the persisted row both carry the trimmed text.
//   [b] GET /api/restaurant/reservations (staff) returns specialRequests
//       in the row shape — this is exactly what feeds SpecialRequestsBadge.
//   [c] POST with no specialRequests → 201, row stores null.
//   [d] POST with whitespace-only specialRequests → 201, row stores null.
//   [e] POST with a 501-char specialRequests → 400 (max-500 validation).
//
// Requires the backend on :4000. Books on La Mama (demo-restaurant-001)
// at a far-future open date so the lamama staff GET can see the row.
// Tears down the reservations it creates.

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const LA_MAMA = 'demo-restaurant-001';
const NOTE = '[smoke-j1a] Window seat please — peanut allergy at the table.';

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

// Pick a far-future date that falls on a day La Mama is open, so the
// booking isn't rejected for "closed on this day".
async function pickOpenDate() {
  const open = await prisma.openingHours.findMany({
    where: { restaurantId: LA_MAMA, isOpen: true },
    select: { dayOfWeek: true },
  });
  const openDays = new Set(open.map((o) => o.dayOfWeek));
  for (let i = 14; i <= 40; i++) {
    const iso = isoDate(i);
    const js = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
    const dow = js === 0 ? 6 : js - 1; // schema: 0=Mon..6=Sun
    if (openDays.has(dow)) return iso;
  }
  return isoDate(14);
}

async function main() {
  const created = [];

  const dinerLogin = await http('POST', '/auth/login', null, {
    email: 'demo@aprez.ro', password: 'user123',
  });
  const dinerToken = dinerLogin.body?.token;
  expect(!!dinerToken, 'diner login → token');

  const staffLogin = await http('POST', '/auth/restaurant/login', null, {
    username: 'lamama', password: 'lamama123',
  });
  const staffToken = staffLogin.body?.token;
  expect(!!staffToken, 'lamama staff login → token');

  const date = await pickOpenDate();
  console.log(`[setup] booking date = ${date} (La Mama open)`);

  console.log('\n[a] POST /reservations WITH specialRequests');
  const a = await http('POST', '/reservations', dinerToken, {
    restaurantId: LA_MAMA, date, time: '19:00', partySize: 2, specialRequests: NOTE,
  });
  expect(a.status === 201, `status=201 (got ${a.status})`);
  if (a.body?.id) created.push(a.body.id);
  expect(a.body?.specialRequests === NOTE, `response echoes specialRequests (got ${JSON.stringify(a.body?.specialRequests)?.slice(0, 60)})`);
  const aRow = a.body?.id ? await prisma.reservation.findUnique({ where: { id: a.body.id }, select: { specialRequests: true } }) : null;
  expect(aRow?.specialRequests === NOTE, 'persisted row has the specialRequests text');

  console.log('\n[b] GET /restaurant/reservations (staff) carries specialRequests');
  const list = await http('GET', `/restaurant/reservations?date=${date}`, staffToken);
  expect(list.status === 200, `status=200 (got ${list.status})`);
  const listRow = Array.isArray(list.body) ? list.body.find((r) => r.id === a.body?.id) : null;
  expect(!!listRow, 'created reservation present in the staff list');
  expect(listRow?.specialRequests === NOTE, 'staff list row carries specialRequests (feeds the ✦ badge)');

  console.log('\n[c] POST with NO specialRequests → row stores null');
  const c = await http('POST', '/reservations', dinerToken, {
    restaurantId: LA_MAMA, date, time: '19:15', partySize: 2,
  });
  expect(c.status === 201, `status=201 (got ${c.status})`);
  if (c.body?.id) created.push(c.body.id);
  const cRow = c.body?.id ? await prisma.reservation.findUnique({ where: { id: c.body.id }, select: { specialRequests: true } }) : null;
  expect(cRow?.specialRequests === null, `omitted → null (got ${JSON.stringify(cRow?.specialRequests)})`);

  console.log('\n[d] POST with whitespace-only specialRequests → row stores null');
  const d = await http('POST', '/reservations', dinerToken, {
    restaurantId: LA_MAMA, date, time: '19:30', partySize: 2, specialRequests: '     ',
  });
  expect(d.status === 201, `status=201 (got ${d.status})`);
  if (d.body?.id) created.push(d.body.id);
  const dRow = d.body?.id ? await prisma.reservation.findUnique({ where: { id: d.body.id }, select: { specialRequests: true } }) : null;
  expect(dRow?.specialRequests === null, `whitespace-only → null (got ${JSON.stringify(dRow?.specialRequests)})`);

  console.log('\n[e] POST with a 501-char specialRequests → 400 (max-500 cap)');
  const e = await http('POST', '/reservations', dinerToken, {
    restaurantId: LA_MAMA, date, time: '19:45', partySize: 2, specialRequests: 'x'.repeat(501),
  });
  expect(e.status === 400, `status=400 (got ${e.status})`);
  if (e.body?.id) created.push(e.body.id); // defensive — shouldn't happen

  console.log('\n[cleanup]');
  for (const id of created) {
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
