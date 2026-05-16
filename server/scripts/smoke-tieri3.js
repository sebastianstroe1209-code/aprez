// Tier I commit 3 smoke — calendar propagation, availability suggestion
// array, reservations-row mergeBinding shape, and the auto-deactivate-
// on-lifecycle invariants per scoping decision C (hybrid).
//
// Coverage:
//   [a] /availability mergeSuggestions array shape (with adjacencies present)
//   [b] /availability empty mergeSuggestions when no adjacencies fit
//   [c] /restaurant/reservations payload carries mergeBinding per row
//       (otherMemberLabels, combinedLabel, summedSeatCount)
//   [d] Merge bound to reservation → restaurant CANCEL deactivates the
//       merge in the same transaction (or atomically before emit)
//   [e] Same for /complete
//   [f] Same for /no-show
//   [g] Diner CANCEL deactivates (the lifecycle hook in diner cancel
//       also runs)
//   [h] Pre-planned merge (reservationId=null) is NOT touched when
//       OTHER reservations cancel — only the bound ones auto-deactivate
//
// Idempotent: cleans up its '[smoke-i3]' section + reservations at
// start and end.

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const SECTION_TAG = '[smoke-i3]';

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function staffToken() {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lamama', password: 'lamama123' }),
  });
  return (await r.json()).token;
}
async function dinerToken() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aprez.ro', password: 'user123' }),
  });
  return (await r.json()).token;
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

function expect(cond, label) {
  if (cond) console.log(`  PASS — ${label}`);
  else { console.error(`  FAIL — ${label}`); process.exitCode = 1; }
}

async function main() {
  const tStaff = await staffToken();
  const tDiner = await dinerToken();
  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  const diner = await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } });
  const rid = restaurant.id;

  // ---- baseline: wipe prior fixture ----
  console.log('\n[baseline] wipe [smoke-i3] fixture');
  const oldSections = await prisma.tableSection.findMany({
    where: { restaurantId: rid, nameEn: SECTION_TAG },
    include: { tables: { select: { id: true } } },
  });
  for (const s of oldSections) {
    const tids = s.tables.map((t) => t.id);
    if (tids.length) {
      await prisma.reservation.deleteMany({ where: { tableId: { in: tids } } });
      await prisma.tableMove.deleteMany({ where: { tableId: { in: tids } } });
    }
    await prisma.tableSection.delete({ where: { id: s.id } }).catch(() => {});
  }

  // ---- fixture: 2x2 adjacency block ----
  const section = await prisma.tableSection.create({
    data: { restaurantId: rid, nameRo: SECTION_TAG, nameEn: SECTION_TAG, gridRows: 2, gridColumns: 2, displayOrder: 98 },
  });
  const mk = (number, seats, row, col) =>
    prisma.restaurantTable.create({
      data: { sectionId: section.id, restaurantId: rid, tableNumber: number, seatCount: seats, gridRow: row, gridCol: col },
    });
  const [tA, tB, tC, tD] = await Promise.all([
    mk('I3A', 2, 0, 0),
    mk('I3B', 2, 0, 1),
    mk('I3C', 2, 1, 0),
    mk('I3D', 2, 1, 1),
  ]);
  const futureDate = new Date(); futureDate.setUTCDate(futureDate.getUTCDate() + 21);
  const dateIso = isoDate(futureDate);

  // ============================================================
  // [a] /availability mergeSuggestions shape with adjacencies
  // ============================================================
  console.log('\n[a] /availability mergeSuggestions shape');
  const rA = await http('GET', `/restaurant/availability?date=${dateIso}&time=19:00&partySize=4`, tStaff);
  expect(rA.status === 200, `status=${rA.status}`);
  expect(Array.isArray(rA.body?.mergeSuggestions), `mergeSuggestions is array`);
  expect(rA.body?.mergeSuggestions?.length > 0, `at least one suggestion for party of 4`);
  const first = rA.body.mergeSuggestions[0];
  expect(Array.isArray(first?.tableIds), `suggestion has tableIds[]`);
  expect(Array.isArray(first?.memberLabels), `suggestion has memberLabels[]`);
  expect(typeof first?.combinedLabel === 'string' && /\+/.test(first.combinedLabel), `combinedLabel is "X+Y" string`);
  expect(typeof first?.summedSeatCount === 'number' && first.summedSeatCount >= 4, `summedSeatCount >= partySize`);
  expect(typeof first?.freeNeighborCount === 'number', `freeNeighborCount is number`);

  // ============================================================
  // [b] /availability empty mergeSuggestions when no merge can fit
  // ============================================================
  console.log('\n[b] /availability empty mergeSuggestions when no adjacency fits');
  // 2x2 block at I3 maxes at 4 tables × 2 seats = 8 total. Party of 99
  // can't fit any combination of adjacent tables.
  const rB = await http('GET', `/restaurant/availability?date=${dateIso}&time=19:00&partySize=99`, tStaff);
  expect(rB.status === 200, `status=${rB.status}`);
  expect(Array.isArray(rB.body?.mergeSuggestions), `mergeSuggestions is array`);
  expect(rB.body?.mergeSuggestions?.length === 0, `no suggestion for party of 99 (got ${rB.body?.mergeSuggestions?.length})`);
  expect(rB.body?.suggestionForCombining === false, `suggestionForCombining=false when no candidate`);

  // ============================================================
  // [c] /restaurant/reservations mergeBinding shape per row
  // ============================================================
  console.log('\n[c] /reservations mergeBinding shape');
  const cResv = await prisma.reservation.create({
    data: {
      userId: diner.id, restaurantId: rid, tableId: tA.id,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '19:00', endTime: '21:00', partySize: 4,
      status: 'CONFIRMED', guestName: '[smoke-i3] mergeBinding row',
    },
  });
  const cMerge = await http('POST', `/restaurant/tables/merge`, tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
    reservationId: cResv.id,
  });
  expect(cMerge.status === 201, `merge setup status=${cMerge.status}`);

  const rC = await http('GET', `/restaurant/reservations?date=${dateIso}`, tStaff);
  expect(rC.status === 200, `list status=${rC.status}`);
  const row = (rC.body || []).find((r) => r.id === cResv.id);
  expect(!!row, `row in list`);
  expect(!!row?.mergeBinding, `mergeBinding present`);
  expect(row?.mergeBinding?.combinedLabel === 'I3A+I3B', `combinedLabel=${row?.mergeBinding?.combinedLabel}`);
  expect(Array.isArray(row?.mergeBinding?.otherMemberLabels), `otherMemberLabels is array`);
  expect(row?.mergeBinding?.otherMemberLabels?.[0] === 'I3B', `otherMemberLabels excludes self (I3A) → ${JSON.stringify(row?.mergeBinding?.otherMemberLabels)}`);
  expect(row?.mergeBinding?.summedSeatCount === 4, `summedSeatCount=${row?.mergeBinding?.summedSeatCount}`);

  // ============================================================
  // [d] Restaurant /cancel auto-deactivates the bound merge
  // ============================================================
  console.log('\n[d] Restaurant /cancel auto-deactivates bound merge');
  const dResv = await prisma.reservation.create({
    data: {
      userId: diner.id, restaurantId: rid, tableId: tA.id,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '12:00', endTime: '14:00', partySize: 4,
      status: 'CONFIRMED', guestName: '[smoke-i3] cancel test',
    },
  });
  const dMerge = await http('POST', `/restaurant/tables/merge`, tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '12:00', timeEnd: '14:00',
    reservationId: dResv.id,
  });
  expect(dMerge.status === 201, `setup merge status=${dMerge.status}`);
  const dCancel = await http('PUT', `/restaurant/reservations/${dResv.id}/cancel`, tStaff);
  expect(dCancel.status === 200, `cancel status=${dCancel.status}`);
  const dAfter = await prisma.tableMove.count({
    where: { mergeGroupId: dMerge.body.groupId, isActive: true },
  });
  expect(dAfter === 0, `merge deactivated (active rows: ${dAfter})`);

  // ============================================================
  // [e] Restaurant /complete auto-deactivates
  // ============================================================
  console.log('\n[e] Restaurant /complete auto-deactivates bound merge');
  const eResv = await prisma.reservation.create({
    data: {
      userId: diner.id, restaurantId: rid, tableId: tC.id,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '15:00', endTime: '17:00', partySize: 4,
      status: 'CONFIRMED', guestName: '[smoke-i3] complete test',
    },
  });
  const eMerge = await http('POST', `/restaurant/tables/merge`, tStaff, {
    tableIds: [tC.id, tD.id],
    date: dateIso, timeStart: '15:00', timeEnd: '17:00',
    reservationId: eResv.id,
  });
  expect(eMerge.status === 201, `setup merge status=${eMerge.status}`);
  const eComplete = await http('PUT', `/restaurant/reservations/${eResv.id}/complete`, tStaff);
  expect(eComplete.status === 200, `complete status=${eComplete.status}`);
  const eAfter = await prisma.tableMove.count({
    where: { mergeGroupId: eMerge.body.groupId, isActive: true },
  });
  expect(eAfter === 0, `merge deactivated (active rows: ${eAfter})`);

  // ============================================================
  // [f] Restaurant /no-show auto-deactivates
  // ============================================================
  console.log('\n[f] Restaurant /no-show auto-deactivates bound merge');
  const fResv = await prisma.reservation.create({
    data: {
      userId: diner.id, restaurantId: rid, tableId: tA.id,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '17:00', endTime: '19:00', partySize: 4,
      status: 'CONFIRMED', guestName: '[smoke-i3] no-show test',
    },
  });
  const fMerge = await http('POST', `/restaurant/tables/merge`, tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '17:00', timeEnd: '19:00',
    reservationId: fResv.id,
  });
  expect(fMerge.status === 201, `setup merge status=${fMerge.status}`);
  const fNoShow = await http('PUT', `/restaurant/reservations/${fResv.id}/no-show`, tStaff);
  expect(fNoShow.status === 200, `no-show status=${fNoShow.status}`);
  const fAfter = await prisma.tableMove.count({
    where: { mergeGroupId: fMerge.body.groupId, isActive: true },
  });
  expect(fAfter === 0, `merge deactivated (active rows: ${fAfter})`);

  // ============================================================
  // [g] Diner CANCEL auto-deactivates
  // ============================================================
  console.log('\n[g] Diner /cancel auto-deactivates bound merge');
  const gResv = await prisma.reservation.create({
    data: {
      userId: diner.id, restaurantId: rid, tableId: tC.id,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '20:00', endTime: '22:00', partySize: 4,
      status: 'CONFIRMED', guestName: '[smoke-i3] diner cancel',
    },
  });
  const gMerge = await http('POST', `/restaurant/tables/merge`, tStaff, {
    tableIds: [tC.id, tD.id],
    date: dateIso, timeStart: '20:00', timeEnd: '22:00',
    reservationId: gResv.id,
  });
  expect(gMerge.status === 201, `setup merge status=${gMerge.status}`);
  const gCancel = await http('PUT', `/reservations/${gResv.id}/cancel`, tDiner);
  expect(gCancel.status === 200, `diner cancel status=${gCancel.status}`);
  const gAfter = await prisma.tableMove.count({
    where: { mergeGroupId: gMerge.body.groupId, isActive: true },
  });
  expect(gAfter === 0, `merge deactivated by diner cancel (active rows: ${gAfter})`);

  // ============================================================
  // [h] Pre-planned merge (reservationId=null) NOT touched by other
  //     reservations' lifecycle events
  // ============================================================
  console.log('\n[h] Pre-planned merge survives other reservations cancelling');
  const hPreMerge = await http('POST', `/restaurant/tables/merge`, tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '23:00', timeEnd: '23:30',
    // reservationId omitted → pre-planned, no auto-deactivate
  });
  expect(hPreMerge.status === 201, `pre-merge setup status=${hPreMerge.status}`);
  expect(hPreMerge.body?.reservationId === null, `reservationId=null`);

  // Cancel an UNRELATED reservation (not bound to this merge).
  const hUnrelated = await prisma.reservation.create({
    data: {
      userId: diner.id, restaurantId: rid, tableId: tC.id,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '11:00', endTime: '13:00', partySize: 2,
      status: 'CONFIRMED', guestName: '[smoke-i3] unrelated',
    },
  });
  const hUnrelatedCancel = await http('PUT', `/restaurant/reservations/${hUnrelated.id}/cancel`, tStaff);
  expect(hUnrelatedCancel.status === 200, `unrelated cancel status=${hUnrelatedCancel.status}`);

  // Pre-merge should still be active.
  const hAfter = await prisma.tableMove.count({
    where: { mergeGroupId: hPreMerge.body.groupId, isActive: true },
  });
  expect(hAfter === 2, `pre-merge still active (active rows: ${hAfter})`);

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\n[cleanup]');
  const allTestIds = [cResv.id, dResv.id, eResv.id, fResv.id, gResv.id, hUnrelated.id];
  await prisma.reservation.deleteMany({ where: { id: { in: allTestIds } } });
  await prisma.tableMove.deleteMany({ where: { tableId: { in: [tA.id, tB.id, tC.id, tD.id] } } });
  await prisma.tableSection.delete({ where: { id: section.id } });

  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
