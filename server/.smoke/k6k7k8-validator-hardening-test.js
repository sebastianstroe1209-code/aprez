// Tier K6+K7+K8 — validator hardening on the diner reservation flow.
//
// K6 — POST /reservations rejects past dates (defense in depth; the
//      mobile picker gates this client-side but the API took past
//      dates pre-K6, creating orphan rows). Structured 400
//      { error: { code: 'date-in-past' } } per the §6.5 contract.
//
// K7 — GET /restaurants/:id/time-slots hard-caps partySize at 30 (the
//      global rule; POST /reservations already enforced it). Pre-K7 a
//      99-person query returned 200 with the full schedule.
//
// K8 — GET /restaurants/:id/time-slots returns 404 for a nonexistent
//      restaurant id (pre-K8 returned 200 + empty schedule, looking
//      like "closed today"); rejects past dates with the same
//      structured code K6 uses.
//
// Happy paths kept intact: future date + party 4 + real restaurant
// returns 200 with timeSlots[] populated.
//
//   [a] POST /reservations with date='2020-01-01' → 400 + code='date-in-past'.
//   [b] POST /reservations with valid future date → no date-in-past 400
//       (may 400 for other reasons, but not this code).
//   [c] GET /time-slots ?partySize=99 → 400.
//   [d] GET /time-slots ?partySize=30 → not 400 (clamp is inclusive of 30).
//   [e] GET /time-slots ?date=2020-01-01 → 400 + code='date-in-past'.
//   [f] GET /time-slots for a fake restaurantId → 404 + code='restaurant-not-found'.
//   [g] Happy path: GET /time-slots for La Mama + tomorrow + party 4
//       → 200 with timeSlots present.
//
// Requires the backend on :4000.

const BASE = 'http://localhost:4000/api';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
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

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

const LA_MAMA = 'demo-restaurant-001';

async function main() {
  console.log('[reset] wipe limiter store so this smoke isn\'t throttled');
  await http('POST', '/__test/reset-rate-limits', null, {});

  const login = await http('POST', '/auth/login', null, { email: 'demo@aprez.ro', password: 'user123' });
  const token = login.body?.token;
  expect(!!token, `diner login → token`);

  console.log('\n[a] POST /reservations with date=2020-01-01 → 400 + date-in-past');
  const a = await http('POST', '/reservations', token, {
    restaurantId: LA_MAMA, date: '2020-01-01', time: '19:00', partySize: 2,
  });
  expect(a.status === 400, `status 400 (got ${a.status})`);
  expect(a.body?.error?.code === 'date-in-past',
    `error.code='date-in-past' (got ${JSON.stringify(a.body)?.slice(0, 120)})`);

  console.log('\n[b] POST /reservations with valid future date → NOT date-in-past');
  const b = await http('POST', '/reservations', token, {
    restaurantId: LA_MAMA, date: tomorrow(), time: '19:00', partySize: 2,
  });
  // Could be 201 (created), 400 (some other reason like banned or
  // no-tables), but specifically NOT a date-in-past 400.
  expect(b.body?.error?.code !== 'date-in-past',
    `not date-in-past on a future date (got status=${b.status} body=${JSON.stringify(b.body)?.slice(0, 120)})`);
  // Cleanup: if the POST created a reservation, the demo user now owns
  // one extra row. Drop it to keep the smoke side-effect-free.
  const reservationId = b.body?.id || b.body?.reservation?.id;
  if (reservationId) {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.reservation.delete({ where: { id: reservationId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log('\n[c] GET /time-slots ?partySize=99 → 400');
  const c = await http('GET', `/restaurants/${LA_MAMA}/time-slots?date=${tomorrow()}&partySize=99`, token);
  expect(c.status === 400, `status 400 (got ${c.status})`);

  console.log('\n[d] GET /time-slots ?partySize=30 → NOT 400 (cap inclusive)');
  const d = await http('GET', `/restaurants/${LA_MAMA}/time-slots?date=${tomorrow()}&partySize=30`, token);
  expect(d.status !== 400, `status not 400 (got ${d.status})`);

  console.log('\n[e] GET /time-slots ?date=2020-01-01 → 400 + date-in-past');
  const e = await http('GET', `/restaurants/${LA_MAMA}/time-slots?date=2020-01-01&partySize=2`, token);
  expect(e.status === 400, `status 400 (got ${e.status})`);
  expect(e.body?.error?.code === 'date-in-past',
    `error.code='date-in-past' (got ${JSON.stringify(e.body)?.slice(0, 120)})`);

  console.log('\n[f] GET /time-slots for a fake restaurantId → 404 + restaurant-not-found');
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const f = await http('GET', `/restaurants/${fakeId}/time-slots?date=${tomorrow()}&partySize=2`, token);
  expect(f.status === 404, `status 404 (got ${f.status})`);
  expect(f.body?.error?.code === 'restaurant-not-found',
    `error.code='restaurant-not-found' (got ${JSON.stringify(f.body)?.slice(0, 120)})`);

  console.log('\n[g] Happy path: real restaurant + future date + party 4 → 200 + timeSlots');
  const g = await http('GET', `/restaurants/${LA_MAMA}/time-slots?date=${tomorrow()}&partySize=4`, token);
  expect(g.status === 200, `status 200 (got ${g.status})`);
  expect(Array.isArray(g.body?.timeSlots), `timeSlots is an array (got ${typeof g.body?.timeSlots})`);

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
