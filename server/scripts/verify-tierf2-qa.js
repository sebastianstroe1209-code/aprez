// Tier F commit 2 QA-closure verification. Re-confirms the remaining QA
// paths the operator asked for, printing verbatim error bodies so the
// 409 contracts are unambiguous in the report. Complements smoke-tierf2.js
// (which reduces to PASS/FAIL); this one quotes the payloads.
//
// Specifically covers:
//   PATH 2a: PUT /api/admin/sections/:id with newRows/newCols that would
//            orphan an existing table → 409 shrink-orphans-tables
//   PATH 2b: DELETE /api/admin/sections/:id with a future reservation
//            attached → 409 section-has-reservations
//   PATH 2c: DELETE /api/admin/sections/:id on a section where only PAST
//            (non-cancelled) reservations remain → 200 + reservation
//            row's tableId is null afterwards so the FK doesn't crash

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

async function adminToken() {
  const r = await fetch(`${BASE}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aprez.ro', password: 'admin123' }),
  });
  const d = await r.json();
  return d.token;
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
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

async function main() {
  const t = await adminToken();
  const restaurant = await prisma.restaurant.findFirst({ orderBy: { createdAt: 'asc' } });
  const rid = restaurant.id;
  const dinerUser = await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } });

  // Wipe any leftover '[QA] tier-f2 verify' sections.
  const old = await prisma.tableSection.findMany({
    where: { restaurantId: rid, nameEn: '[QA] tier-f2 verify' },
    include: { tables: { select: { id: true } } },
  });
  for (const s of old) {
    const tids = s.tables.map((x) => x.id);
    if (tids.length) await prisma.reservation.deleteMany({ where: { tableId: { in: tids } } });
    await prisma.tableSection.delete({ where: { id: s.id } }).catch(() => {});
  }

  // ============================================================
  // PATH 2a — PUT shrink → 409 shrink-orphans-tables (full body)
  // ============================================================
  console.log('\n=== PATH 2a: PUT /sections/:id shrink with orphan ===');
  const sec = await http('POST', `/admin/restaurants/${rid}/sections`, t, {
    nameRo: '[QA] tier-f2 verify',
    nameEn: '[QA] tier-f2 verify',
    gridRows: 6,
    gridColumns: 6,
  });
  const sid = sec.body.id;
  await http('POST', `/admin/sections/${sid}/tables`, t, {
    tableNumber: 'QA-5-0', seatCount: 2, gridRow: 5, gridCol: 0,
  });
  await http('POST', `/admin/sections/${sid}/tables`, t, {
    tableNumber: 'QA-1-1', seatCount: 2, gridRow: 1, gridCol: 1,
  });

  const shrink = await http('PUT', `/admin/sections/${sid}`, t, { gridRows: 3 });
  console.log(`HTTP ${shrink.status}`);
  console.log('BODY:', JSON.stringify(shrink.body, null, 2));

  // ============================================================
  // PATH 2b — DELETE with future reservation → 409 section-has-reservations
  // ============================================================
  console.log('\n=== PATH 2b: DELETE /sections/:id with future reservation ===');
  const sec2 = await http('POST', `/admin/restaurants/${rid}/sections`, t, {
    nameRo: '[QA] tier-f2 verify',
    nameEn: '[QA] tier-f2 verify',
    gridRows: 4,
    gridColumns: 4,
  });
  const sid2 = sec2.body.id;
  const tbl2 = await http('POST', `/admin/sections/${sid2}/tables`, t, {
    tableNumber: 'QA-FUT', seatCount: 2, gridRow: 0, gridCol: 0,
  });
  const futureDate = new Date();
  futureDate.setUTCDate(futureDate.getUTCDate() + 14);
  await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      tableId: tbl2.body.id,
      date: new Date(futureDate.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
      time: '20:00',
      endTime: '22:00',
      partySize: 2,
      status: 'CONFIRMED',
      guestName: 'QA Future',
    },
  });
  const del2 = await http('DELETE', `/admin/sections/${sid2}`, t);
  console.log(`HTTP ${del2.status}`);
  console.log('BODY:', JSON.stringify(del2.body, null, 2));

  // ============================================================
  // PATH 2c — DELETE with PAST (non-cancelled) reservation only → 200
  // and the past reservation's tableId is nulled in the same transaction
  // ============================================================
  console.log('\n=== PATH 2c: DELETE /sections/:id with PAST reservation only ===');
  const sec3 = await http('POST', `/admin/restaurants/${rid}/sections`, t, {
    nameRo: '[QA] tier-f2 verify',
    nameEn: '[QA] tier-f2 verify',
    gridRows: 4,
    gridColumns: 4,
  });
  const sid3 = sec3.body.id;
  const tbl3 = await http('POST', `/admin/sections/${sid3}/tables`, t, {
    tableNumber: 'QA-PAST', seatCount: 2, gridRow: 0, gridCol: 0,
  });
  const pastDate = new Date();
  pastDate.setUTCDate(pastDate.getUTCDate() - 30);
  const pastResv = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      tableId: tbl3.body.id,
      date: new Date(pastDate.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
      time: '19:00',
      endTime: '21:00',
      partySize: 2,
      status: 'COMPLETED',  // non-cancelled, so it counts toward pastCount
      guestName: 'QA Historical',
    },
  });
  console.log(`Created past reservation ${pastResv.id} with tableId=${pastResv.tableId}`);

  const del3 = await http('DELETE', `/admin/sections/${sid3}`, t);
  console.log(`DELETE → HTTP ${del3.status}`);
  console.log('BODY:', JSON.stringify(del3.body, null, 2));

  const after = await prisma.reservation.findUnique({ where: { id: pastResv.id } });
  if (!after) {
    console.error('FAIL — past reservation row was deleted (should have been preserved with tableId=null)');
    process.exitCode = 1;
  } else if (after.tableId !== null) {
    console.error(`FAIL — past reservation row tableId is "${after.tableId}", expected null`);
    process.exitCode = 1;
  } else {
    console.log(`PASS — past reservation row preserved with tableId=null + status=${after.status}`);
  }

  // Cleanup the throwaway data.
  console.log('\n=== Cleanup ===');
  // Drop the future-resv section's reservation, then delete section 2.
  const sec2Tables = await prisma.restaurantTable.findMany({ where: { sectionId: sid2 }, select: { id: true } });
  if (sec2Tables.length) {
    await prisma.reservation.deleteMany({ where: { tableId: { in: sec2Tables.map((x) => x.id) } } });
  }
  await prisma.tableSection.delete({ where: { id: sid2 } }).catch(() => {});
  // Section 1 (shrink) still exists.
  await prisma.tableSection.delete({ where: { id: sid } }).catch(() => {});
  // Drop the now-orphaned past reservation row.
  await prisma.reservation.delete({ where: { id: pastResv.id } }).catch(() => {});
  console.log('cleanup done');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('VERIFY THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
