// Tier F commit 2 smoke — covers all 9 paths the user asked for:
//   a. POST disabled-date for tomorrow → 201, row inserted
//   b. POST same date again → 400 already-exists
//   c. POST past date → 400 date-in-past
//   d. DELETE disabled-date → 200, row removed
//   e. Create a reservation on a disabled date → 400 (existing enforcement)
//   f. PUT section gridRows shrink with table outside → 409 shrink-orphans-tables
//   g. PUT section gridRows expand → 200
//   h. DELETE section with future reservation → 409 section-has-reservations
//   i. DELETE empty section → 200
//
// Plus regressions: Tier F1 photo upload + Tier D2 diner login both
// still 200.
//
// Idempotent: at start, wipes any disabled dates the test owns and any
// "[smoke]" section it created. Leaves the seed otherwise untouched.

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const SMOKE_SECTION_NAME = '[smoke] tier-f2 section';

function tomorrowIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function adminToken() {
  const r = await fetch(`${BASE}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aprez.ro', password: 'admin123' }),
  });
  const data = await r.json();
  if (!data.token) throw new Error('admin login failed: ' + JSON.stringify(data));
  return data.token;
}

async function dinerToken() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aprez.ro', password: 'user123' }),
  });
  const data = await r.json();
  if (!data.token) throw new Error('diner login failed: ' + JSON.stringify(data));
  return data.token;
}

async function http(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, body: json };
}

function expect(cond, label) {
  if (cond) console.log(`  PASS — ${label}`);
  else { console.error(`  FAIL — ${label}`); process.exitCode = 1; }
}

async function main() {
  const tAdmin = await adminToken();
  const tDiner = await dinerToken();

  const restaurant = await prisma.restaurant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!restaurant) { console.error('no restaurants'); process.exit(1); }
  const rid = restaurant.id;
  console.log(`Smoke target: ${restaurant.nameEn} (${rid})`);

  // ---- baseline cleanup ----
  console.log('\n[baseline] wipe smoke disabled-dates + smoke section + smoke reservations');
  const tomorrow = tomorrowIso();
  await prisma.disabledDate.deleteMany({
    where: { restaurantId: rid, date: new Date(`${tomorrow}T00:00:00.000Z`) },
  });
  const smokeSections = await prisma.tableSection.findMany({
    where: { restaurantId: rid, nameEn: SMOKE_SECTION_NAME },
    include: { tables: { select: { id: true } } },
  });
  for (const s of smokeSections) {
    const tids = s.tables.map((t) => t.id);
    if (tids.length) {
      await prisma.reservation.deleteMany({ where: { tableId: { in: tids } } });
    }
    await prisma.tableSection.delete({ where: { id: s.id } }).catch(() => {});
  }

  // ============================================================
  // a. POST disabled-date for tomorrow
  // ============================================================
  console.log('\n[a] POST disabled-date for tomorrow');
  const r1 = await http('POST', `/admin/restaurants/${rid}/disabled-dates`, tAdmin, {
    date: tomorrow,
    reason: 'Private event',
  });
  expect(r1.status === 201, `status=${r1.status}`);
  expect(!!r1.body?.id, `row id returned: ${r1.body?.id}`);
  const disabledId = r1.body?.id;

  // ============================================================
  // b. POST same date again → 400 already-exists
  // ============================================================
  console.log('\n[b] POST same date again → 400 already-exists');
  const r2 = await http('POST', `/admin/restaurants/${rid}/disabled-dates`, tAdmin, {
    date: tomorrow,
  });
  expect(r2.status === 400, `status=${r2.status}`);
  expect(r2.body?.error?.code === 'already-exists', `error.code=${r2.body?.error?.code}`);

  // ============================================================
  // c. POST past date → 400 date-in-past
  // ============================================================
  console.log('\n[c] POST past date → 400 date-in-past');
  const r3 = await http('POST', `/admin/restaurants/${rid}/disabled-dates`, tAdmin, {
    date: yesterdayIso(),
  });
  expect(r3.status === 400, `status=${r3.status}`);
  expect(r3.body?.error?.code === 'date-in-past', `error.code=${r3.body?.error?.code}`);

  // ============================================================
  // e (intentionally before d so the row still exists)
  // — Create a reservation on the disabled date → rejected
  // ============================================================
  console.log('\n[e] Diner cannot book the disabled date');
  // POST /reservations enforces disabled dates via the existing handler
  // at server/src/routes/reservation.routes.js:100.
  const rResv = await http('POST', `/reservations`, tDiner, {
    restaurantId: rid,
    date: tomorrow,
    time: '19:00',
    partySize: 2,
  });
  expect(rResv.status === 400, `status=${rResv.status}`);
  const msg = (typeof rResv.body?.error === 'string' ? rResv.body.error : rResv.body?.error?.message) || '';
  expect(/not available on this date/i.test(msg), `error message: "${msg}"`);

  // Also check the time-slots endpoint returns the disabled marker.
  const rSlots = await http('GET', `/restaurants/${rid}/time-slots?date=${tomorrow}&partySize=2`, tDiner);
  expect(rSlots.status === 200, `time-slots status=${rSlots.status}`);
  expect(rSlots.body?.disabled === true, `time-slots disabled=true (got ${rSlots.body?.disabled})`);

  // And the diner-facing list endpoint returns the date.
  const rList = await http('GET', `/restaurants/${rid}/disabled-dates`, tDiner);
  expect(rList.status === 200, `disabled-dates list status=${rList.status}`);
  expect(Array.isArray(rList.body) && rList.body.some((row) => row.date?.startsWith(tomorrow)), `tomorrow present in list`);

  // ============================================================
  // d. DELETE disabled-date → 200
  // ============================================================
  console.log('\n[d] DELETE disabled-date');
  const r4 = await http('DELETE', `/admin/restaurants/${rid}/disabled-dates/${disabledId}`, tAdmin);
  expect(r4.status === 200, `status=${r4.status}`);
  const stillThere = await prisma.disabledDate.findUnique({ where: { id: disabledId } });
  expect(!stillThere, `row removed from DB`);

  // ============================================================
  // f. PUT section gridRows shrink with a table outside → 409
  // ============================================================
  console.log('\n[f] Create smoke section + table at (5,0) then shrink to 3 rows → 409');
  const sectionCreate = await http('POST', `/admin/restaurants/${rid}/sections`, tAdmin, {
    nameRo: SMOKE_SECTION_NAME,
    nameEn: SMOKE_SECTION_NAME,
    gridRows: 6,
    gridColumns: 6,
  });
  expect(sectionCreate.status === 201 || sectionCreate.status === 200, `section create status=${sectionCreate.status}`);
  const sid = sectionCreate.body?.id;
  expect(!!sid, `section id: ${sid}`);

  const tableCreate = await http('POST', `/admin/sections/${sid}/tables`, tAdmin, {
    tableNumber: 'TSMOKE',
    seatCount: 2,
    gridRow: 5,
    gridCol: 0,
  });
  expect(tableCreate.status === 201 || tableCreate.status === 200, `table create status=${tableCreate.status}`);
  const tid = tableCreate.body?.id;

  const rShrink = await http('PUT', `/admin/sections/${sid}`, tAdmin, { gridRows: 3 });
  expect(rShrink.status === 409, `shrink status=${rShrink.status}`);
  expect(rShrink.body?.error?.code === 'shrink-orphans-tables', `error.code=${rShrink.body?.error?.code}`);
  expect(rShrink.body?.error?.orphanCount === 1, `orphanCount=${rShrink.body?.error?.orphanCount}`);
  expect(rShrink.body?.error?.sampleTables?.[0]?.tableNumber === 'TSMOKE', `sampleTables[0].tableNumber matches`);

  // ============================================================
  // g. PUT section gridRows expand → 200
  // ============================================================
  console.log('\n[g] PUT expand grid → 200');
  const rExpand = await http('PUT', `/admin/sections/${sid}`, tAdmin, { gridRows: 10 });
  expect(rExpand.status === 200, `expand status=${rExpand.status}`);
  expect(rExpand.body?.gridRows === 10, `gridRows=${rExpand.body?.gridRows}`);

  // ============================================================
  // h. DELETE section with future reservation → 409
  // ============================================================
  console.log('\n[h] Attach future reservation then DELETE section → 409');
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 7);
  const futureDateOnly = new Date(future.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const futureResv = await prisma.reservation.create({
    data: {
      userId: (await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } })).id,
      restaurantId: rid,
      tableId: tid,
      date: futureDateOnly,
      time: '19:00',
      endTime: '21:00',
      partySize: 2,
      status: 'CONFIRMED',
      guestName: 'Smoke Future',
    },
  });
  const rDelBlocked = await http('DELETE', `/admin/sections/${sid}`, tAdmin);
  expect(rDelBlocked.status === 409, `status=${rDelBlocked.status}`);
  expect(rDelBlocked.body?.error?.code === 'section-has-reservations', `error.code=${rDelBlocked.body?.error?.code}`);
  expect(rDelBlocked.body?.error?.count === 1, `count=${rDelBlocked.body?.error?.count}`);

  // ============================================================
  // i. DELETE empty section → 200
  // ============================================================
  console.log('\n[i] Cancel future, drop the table, then DELETE section → 200');
  // Cancel the future reservation so the 409 guard relaxes.
  await prisma.reservation.update({
    where: { id: futureResv.id },
    data: { status: 'CANCELLED' },
  });
  // Also: drop the table directly. Past-only attached path: section should
  // null-out tableIds + cascade. With status=CANCELLED the guard already
  // releases, so cascade-delete cleans the table.
  const rDelOk = await http('DELETE', `/admin/sections/${sid}`, tAdmin);
  expect(rDelOk.status === 200, `status=${rDelOk.status}`);
  const sectionGone = await prisma.tableSection.findUnique({ where: { id: sid } });
  expect(!sectionGone, `section gone from DB`);

  // ============================================================
  // [REG] Tier D2 diner login + Tier F1 admin photo list still work
  // ============================================================
  console.log('\n[REG] Tier D2 + Tier F1 regressions');
  const r5 = await http('POST', `/auth/login`, null, undefined);
  // unused signal — replaced by login fetch above
  const dl = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aprez.ro', password: 'user123' }),
  });
  expect(dl.status === 200, `D2 diner login=${dl.status}`);
  // F1: admin GET restaurant should still include photos[]
  const adminRest = await http('GET', `/admin/restaurants/${rid}`, tAdmin);
  expect(adminRest.status === 200, `F1 admin restaurant GET=${adminRest.status}`);
  expect(Array.isArray(adminRest.body?.photos), `F1 photos[] present`);

  // ---- cleanup leftover smoke reservations ----
  await prisma.reservation.deleteMany({ where: { id: futureResv.id } });

  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
