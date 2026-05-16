// Tier I commit 1 smoke — table merging + assign-table force +
// walk-in resolves through merge + live payload merge sub-object.
// 12 paths:
//   1.  2-table merge happy → 201, mergeGroupId shape, summedSeatCount,
//       combinedLabel sorted, /layout/live carries merge on both members.
//   2.  4-table merge happy.
//   3.  5-table merge → 400 merge-cap-exceeded.
//   4.  Non-adjacent member set → 400 not-adjacent.
//   5.  One member OCCUPIED → 409 member-not-mergeable.
//   6.  Time-window conflict with another active merge → 409
//       merge-window-conflict.
//   7.  Unmerge happy → all rows deactivated atomically, table:unmerged
//       socket event fires.
//   8.  Unmerge of a group with no active rows (idempotent) → 200 with
//       deactivated:0.
//   9.  assign-table on party-too-large WITHOUT force → 409 party-too-large
//       with structured body (tableLabel, seatCount, partySize, mergeGroupId).
//   10. assign-table on party-too-large WITH force=true → 200.
//   11. walk-in seat on a member tableId of a merge → all merge members
//       flip OCCUPIED in one txn; per-member table:status-changed events fire.
//   12. /layout/live merge sub-object: null for standalone, populated for
//       merged tables, omitted (filtered) when the time window doesn't
//       cover "now".
//
// Test fixture: creates a throwaway TableSection `[smoke-i1]` with a
// 2x2 grid of adjacent tables so the adjacency check has something
// real to bite on (the demo seed's Interior section has tables at
// 2-cell intervals — no Manhattan-1 adjacencies exist by default).
// Cleans up the section (cascades to tables + TableMove rows) at end.

const { PrismaClient } = require('@prisma/client');
const path = require('path');
const { io: ioClient } = require('socket.io-client');

const BASE = 'http://localhost:4000/api';
const SOCKET_BASE = 'http://localhost:4000';
const prisma = new PrismaClient();
const SECTION_TAG = '[smoke-i1]';

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function staffToken() {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lamama', password: 'lamama123' }),
  });
  const d = await r.json();
  return d.token;
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

// Wait for `pred()` to return truthy with a polling timeout. Used to
// catch socket events that arrive a few ms after the HTTP response.
async function waitFor(pred, timeoutMs = 1500, intervalMs = 25) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return pred();
}

async function main() {
  const tStaff = await staffToken();
  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  const dinerUser = await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } });
  const rid = restaurant.id;
  console.log(`Smoke target: ${restaurant.nameEn} (${rid})`);

  // Wipe any prior smoke section + TableMoves.
  console.log('\n[baseline] wipe prior [smoke-i1] fixture');
  const oldSections = await prisma.tableSection.findMany({
    where: { restaurantId: rid, nameEn: SECTION_TAG },
    include: { tables: { select: { id: true } } },
  });
  for (const s of oldSections) {
    const tids = s.tables.map((t) => t.id);
    if (tids.length) {
      await prisma.tableMove.deleteMany({ where: { tableId: { in: tids } } });
      await prisma.reservation.deleteMany({ where: { tableId: { in: tids } } });
    }
    await prisma.tableSection.delete({ where: { id: s.id } }).catch(() => {});
  }

  // Build the fixture: 2x2 grid in a fresh section, plus a far-away
  // table for the non-adjacent test and a fifth adjacent table for the
  // cap test.
  //
  //   Cols: 0   1   2   3
  // R 0:  A   B   .   .
  // R 1:  C   D   E   .
  // R 2:  .   .   .   FAR
  //
  // A-B-C-D form a 2x2; E is adjacent to D (extends to a 5-member
  // attempt). FAR is at (2,3) — diagonal/distant from all others.
  console.log('\n[fixture] create section + 6 tables');
  const section = await prisma.tableSection.create({
    data: {
      restaurantId: rid,
      nameRo: SECTION_TAG, nameEn: SECTION_TAG,
      gridRows: 3, gridColumns: 4, displayOrder: 99,
    },
  });
  const mk = (number, seats, row, col) =>
    prisma.restaurantTable.create({
      data: { sectionId: section.id, restaurantId: rid, tableNumber: number, seatCount: seats, gridRow: row, gridCol: col },
    });
  const [tA, tB, tC, tD, tE, tFAR] = await Promise.all([
    mk('SA', 2, 0, 0),
    mk('SB', 2, 0, 1),
    mk('SC', 2, 1, 0),
    mk('SD', 4, 1, 1),
    mk('SE', 2, 1, 2),
    mk('SFAR', 2, 2, 3),
  ]);
  // Tables we'll re-set status on between tests:
  const allTableIds = [tA.id, tB.id, tC.id, tD.id, tE.id, tFAR.id];
  const reset = async () => {
    await prisma.tableMove.deleteMany({ where: { tableId: { in: allTableIds } } });
    await prisma.restaurantTable.updateMany({
      where: { id: { in: allTableIds } }, data: { status: 'FREE', statusChangedAt: null },
    });
  };

  // ============================================================
  // Open a socket connection to capture table:merged / table:unmerged
  // emits. JWT handshake auto-joins the restaurant:{id} room.
  // ============================================================
  const seenEvents = []; // { name, payload, at }
  const sock = ioClient(SOCKET_BASE, {
    auth: { token: tStaff },
    transports: ['websocket'],
  });
  await new Promise((resolve, reject) => {
    sock.on('connect', resolve);
    sock.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 3000);
  });
  for (const name of ['table:merged', 'table:unmerged', 'table:status-changed', 'walkin:created']) {
    sock.on(name, (payload) => seenEvents.push({ name, payload, at: Date.now() }));
  }

  const futureDate = new Date(); futureDate.setUTCDate(futureDate.getUTCDate() + 14);
  const dateIso = isoDate(futureDate);

  // ============================================================
  // 1. 2-table merge happy
  // ============================================================
  console.log('\n[1] 2-table merge happy');
  await reset();
  seenEvents.length = 0;
  const r1 = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r1.status === 201, `status=${r1.status}`);
  expect(!!r1.body?.groupId, `groupId returned`);
  expect(r1.body?.members?.length === 2, `members.length=${r1.body?.members?.length}`);
  expect(r1.body?.summedSeatCount === 4, `summedSeatCount=${r1.body?.summedSeatCount}`);
  expect(r1.body?.combinedLabel === 'SA+SB', `combinedLabel=${r1.body?.combinedLabel}`);
  await waitFor(() => seenEvents.some((e) => e.name === 'table:merged'));
  expect(seenEvents.some((e) => e.name === 'table:merged'), `table:merged socket event fired`);
  const happyGroupId = r1.body.groupId;

  // ============================================================
  // 2. 4-table merge happy (the 2x2 block A-B-C-D)
  // ============================================================
  console.log('\n[2] 4-table merge happy');
  await reset();
  seenEvents.length = 0;
  const r2 = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id, tC.id, tD.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r2.status === 201, `status=${r2.status}`);
  expect(r2.body?.members?.length === 4, `members.length=${r2.body?.members?.length}`);
  expect(r2.body?.summedSeatCount === 10, `summedSeatCount=${r2.body?.summedSeatCount}`);
  expect(r2.body?.combinedLabel === 'SA+SB+SC+SD', `combinedLabel=${r2.body?.combinedLabel}`);

  // ============================================================
  // 3. 5-table merge → 400 merge-cap-exceeded
  // ============================================================
  console.log('\n[3] 5-table merge → 400 merge-cap-exceeded');
  await reset();
  const r3 = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id, tC.id, tD.id, tE.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r3.status === 400, `status=${r3.status}`);
  expect(r3.body?.error?.code === 'merge-cap-exceeded', `error.code=${r3.body?.error?.code}`);

  // ============================================================
  // 4. Non-adjacent (A + FAR) → 400 not-adjacent
  // ============================================================
  console.log('\n[4] Non-adjacent → 400 not-adjacent');
  await reset();
  const r4 = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tFAR.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r4.status === 400, `status=${r4.status}`);
  expect(r4.body?.error?.code === 'not-adjacent', `error.code=${r4.body?.error?.code}`);

  // ============================================================
  // 5. One member OCCUPIED → 409 member-not-mergeable
  // ============================================================
  console.log('\n[5] Member OCCUPIED → 409 member-not-mergeable');
  await reset();
  await prisma.restaurantTable.update({ where: { id: tB.id }, data: { status: 'OCCUPIED' } });
  const r5 = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r5.status === 409, `status=${r5.status}`);
  expect(r5.body?.error?.code === 'member-not-mergeable', `error.code=${r5.body?.error?.code}`);
  await prisma.restaurantTable.update({ where: { id: tB.id }, data: { status: 'FREE' } });

  // ============================================================
  // 6. Time-window conflict → 409 merge-window-conflict
  // ============================================================
  console.log('\n[6] Window conflict → 409 merge-window-conflict');
  await reset();
  // First merge A+B at 19:00-21:00.
  const r6a = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id],
    date: dateIso, timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r6a.status === 201, `setup merge status=${r6a.status}`);
  // Now try to merge B+D (B is in active merge) at 20:00-22:00 (overlaps).
  const r6 = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tB.id, tD.id],
    date: dateIso, timeStart: '20:00', timeEnd: '22:00',
  });
  expect(r6.status === 409, `status=${r6.status}`);
  expect(r6.body?.error?.code === 'merge-window-conflict', `error.code=${r6.body?.error?.code}`);

  // ============================================================
  // 7. Unmerge happy → atomic + socket event
  // ============================================================
  console.log('\n[7] Unmerge happy');
  seenEvents.length = 0;
  const setupGroupId = r6a.body.groupId;
  const r7 = await http('PUT', `/restaurant/merges/${setupGroupId}/unmerge`, tStaff);
  expect(r7.status === 200, `status=${r7.status}`);
  expect(r7.body?.deactivated === 2, `deactivated=${r7.body?.deactivated}`);
  await waitFor(() => seenEvents.some((e) => e.name === 'table:unmerged'));
  expect(seenEvents.some((e) => e.name === 'table:unmerged'), `table:unmerged event fired`);

  const stillActive = await prisma.tableMove.count({ where: { mergeGroupId: setupGroupId, isActive: true } });
  expect(stillActive === 0, `0 active rows remain (got ${stillActive})`);

  // ============================================================
  // 8. Unmerge on already-deactivated → 200 idempotent
  // ============================================================
  console.log('\n[8] Unmerge idempotent');
  const r8 = await http('PUT', `/restaurant/merges/${setupGroupId}/unmerge`, tStaff);
  expect(r8.status === 200, `status=${r8.status}`);
  expect(r8.body?.deactivated === 0, `deactivated=${r8.body?.deactivated}`);

  // ============================================================
  // 9. assign-table party-too-large WITHOUT force → 409
  //     Seed a reservation party=10 on the demo diner, try to assign
  //     to a 2-seat table (tA).
  // ============================================================
  console.log('\n[9] assign-table party-too-large → 409');
  await reset();
  const resv = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      time: '19:00', endTime: '21:00',
      partySize: 10,
      status: 'PENDING',
      guestName: '[smoke-i1] big party',
    },
  });
  const r9 = await http('PUT', `/restaurant/reservations/${resv.id}/assign-table`, tStaff, {
    tableId: tA.id,
  });
  expect(r9.status === 409, `status=${r9.status}`);
  expect(r9.body?.error?.code === 'party-too-large', `error.code=${r9.body?.error?.code}`);
  expect(r9.body?.error?.tableLabel === 'SA', `tableLabel=${r9.body?.error?.tableLabel}`);
  expect(r9.body?.error?.seatCount === 2, `seatCount=${r9.body?.error?.seatCount}`);
  expect(r9.body?.error?.partySize === 10, `partySize=${r9.body?.error?.partySize}`);

  // ============================================================
  // 10. assign-table WITH force=true → 200
  // ============================================================
  console.log('\n[10] assign-table force=true → 200');
  const r10 = await http('PUT', `/restaurant/reservations/${resv.id}/assign-table`, tStaff, {
    tableId: tA.id, force: true,
  });
  expect(r10.status === 200, `status=${r10.status}`);
  expect(r10.body?.tableId === tA.id, `tableId assigned`);

  // ============================================================
  // 11. Walk-in on a merge member tableId flips the whole group
  //     OCCUPIED + emits per-member table:status-changed.
  // ============================================================
  console.log('\n[11] Walk-in resolves through merge');
  await reset();
  // Build a fresh 2-table merge in a window covering "now" so the live
  // payload + walk-in resolver pick it up. Use a wide enough window.
  const now = new Date();
  const todayBuch = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const r11a = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id],
    date: todayBuch, timeStart: '00:00', timeEnd: '23:59',
  });
  expect(r11a.status === 201, `setup merge status=${r11a.status}`);
  seenEvents.length = 0;
  const r11 = await http('PUT', `/restaurant/tables/${tA.id}/seat`, tStaff, {
    guestCount: 4, walkInName: 'walk-in via merge',
  });
  expect(r11.status === 200, `seat status=${r11.status}`);
  expect(r11.body?.mergeGroupId === r11a.body.groupId, `seat response carries mergeGroupId`);
  // Both members should be OCCUPIED now.
  const afterSeat = await prisma.restaurantTable.findMany({
    where: { id: { in: [tA.id, tB.id] } }, select: { id: true, status: true },
  });
  expect(afterSeat.every((t) => t.status === 'OCCUPIED'), `both members OCCUPIED (got ${afterSeat.map((t) => t.status).join(',')})`);
  await waitFor(() => seenEvents.filter((e) => e.name === 'table:status-changed').length >= 2);
  const statusEvents = seenEvents.filter((e) => e.name === 'table:status-changed');
  expect(statusEvents.length >= 2, `≥2 table:status-changed emits (got ${statusEvents.length})`);
  // Cleanup: flip back to FREE to keep the fixture clean.
  await reset();

  // ============================================================
  // 12. /layout/live merge sub-object: null for standalone, populated
  //     for merged, filtered out when window doesn't cover now.
  // ============================================================
  console.log('\n[12] /layout/live merge sub-object');
  // 12a: standalone — no merge, expect merge: null on the test tables.
  const r12a = await http('GET', `/restaurant/layout/live`, tStaff);
  expect(r12a.status === 200, `live status=${r12a.status}`);
  const tA_live = r12a.body.find((t) => t.id === tA.id);
  expect(tA_live?.merge === null, `standalone tA: merge=${JSON.stringify(tA_live?.merge)}`);

  // 12b: merge in a window covering NOW → live payload carries merge.
  const r12b = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id],
    date: todayBuch, timeStart: '00:00', timeEnd: '23:59',
  });
  expect(r12b.status === 201, `setup merge status=${r12b.status}`);
  const r12c = await http('GET', `/restaurant/layout/live`, tStaff);
  const tA_live2 = r12c.body.find((t) => t.id === tA.id);
  const tB_live2 = r12c.body.find((t) => t.id === tB.id);
  expect(tA_live2?.merge?.groupId === r12b.body.groupId, `merged tA: merge.groupId matches`);
  expect(tB_live2?.merge?.groupId === r12b.body.groupId, `merged tB: same merge.groupId`);
  expect(tA_live2?.merge?.summedSeatCount === 4, `merge.summedSeatCount=${tA_live2?.merge?.summedSeatCount}`);
  expect(tA_live2?.merge?.combinedLabel === 'SA+SB', `merge.combinedLabel=${tA_live2?.merge?.combinedLabel}`);

  // 12c: merge in a window NOT covering NOW (e.g. tomorrow) → live
  // payload filters it out, merge=null again.
  await prisma.tableMove.updateMany({
    where: { mergeGroupId: r12b.body.groupId }, data: { isActive: false },
  });
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const r12d = await http('POST', '/restaurant/tables/merge', tStaff, {
    tableIds: [tA.id, tB.id],
    date: isoDate(tomorrow), timeStart: '19:00', timeEnd: '21:00',
  });
  expect(r12d.status === 201, `tomorrow merge status=${r12d.status}`);
  const r12e = await http('GET', `/restaurant/layout/live`, tStaff);
  const tA_live3 = r12e.body.find((t) => t.id === tA.id);
  expect(tA_live3?.merge === null, `tomorrow merge not in today's live (got merge=${JSON.stringify(tA_live3?.merge)})`);

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\n[cleanup]');
  await prisma.reservation.deleteMany({ where: { id: resv.id } });
  await prisma.tableMove.deleteMany({ where: { tableId: { in: allTableIds } } });
  await prisma.tableSection.delete({ where: { id: section.id } }).catch(() => {});

  sock.disconnect();
  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
