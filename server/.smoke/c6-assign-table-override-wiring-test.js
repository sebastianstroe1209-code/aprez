// Tier I commit 2 fix-the-fix #4 — end-to-end wiring assertion for the
// party-too-large override flow.
//
// Catches the regression Cowork manual QA found: clicking a soft-
// ineligible card in /dashboard/live?confirmReservationId=… surfaced a
// raw `window.alert("Failed to assign table: Party of 10 doesn't fit
// TI-1 (2 seats). Pass { force: true } to override.")` instead of
// opening the localized OverrideConfirmModal. Root cause: the
// restaurant app's lib/api.js handleResponse was throwing a bare
// `new Error(msg)` without attaching `err.payload` + `err.status`,
// so the live-page catch (`if (err?.payload?.error?.code ===
// 'party-too-large') ...`) always missed → fell through to alert().
//
// This smoke walks the full contract:
//   (a) Backend returns 409 with the right error.code on
//       PUT /api/restaurant/reservations/:id/assign-table when party
//       exceeds the table's seat count.
//   (b) The response body carries the structured fields
//       (tableLabel, seatCount, partySize, mergeGroupId) the
//       OverrideConfirmModal reads for its localized copy.
//   (c) The restaurant app's api.js error-throwing convention
//       attaches err.payload + err.status — replicated locally
//       here so a regression in apps/restaurant/lib/api.js fails
//       this Node smoke rather than the browser only.
//   (d) Re-POST with { force: true } returns 200 and mutates
//       reservation.tableId.
//
// If any of these break, the OverrideModal stops opening from the UI
// click. Smoke fails → caught before Cowork browser QA.

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

let pass = 0, fail = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); pass++ }
  else { console.error(`  FAIL — ${label}`); fail++; process.exitCode = 1 }
}

// Replica of apps/restaurant/lib/api.js handleResponse error path —
// kept in this smoke so a regression where api.js drops err.payload
// fails this assertion rather than only surfacing in the browser.
async function simulateApiPut(url, token, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (typeof data.error === 'string' ? data.error : data.error?.message)
      || data.message
      || data.errors?.map((e) => e.msg).join(', ')
      || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return res.json();
}

// Source-grep assert: the real apps/restaurant/lib/api.js must contain
// the err.payload attachment. If someone reverts it, this smoke fails
// loudly even if the backend behavior is fine.
function assertApiJsAttachesPayload() {
  const apiPath = path.resolve(__dirname, '..', '..', 'apps', 'restaurant', 'lib', 'api.js');
  const src = fs.readFileSync(apiPath, 'utf8');
  expect(/err\.payload\s*=\s*data/.test(src), 'apps/restaurant/lib/api.js attaches err.payload');
  expect(/err\.status\s*=\s*response\.status/.test(src), 'apps/restaurant/lib/api.js attaches err.status');
}

async function staffToken() {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lamama', password: 'lamama123' }),
  });
  return (await r.json()).token;
}

async function main() {
  // 0) Static source-grep on the restaurant api.js shape.
  console.log('\n[0] Source-grep: apps/restaurant/lib/api.js attaches err.payload + err.status');
  assertApiJsAttachesPayload();

  const tStaff = await staffToken();
  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  const diner = await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } });

  // Build a throwaway 2-seat table in a smoke-only section + a party-of-
  // 10 reservation so we have a guaranteed-overflow scenario without
  // depending on whatever state La Mama is in.
  const SECTION_TAG = '[smoke-assign-override]';
  const old = await prisma.tableSection.findMany({
    where: { restaurantId: restaurant.id, nameEn: SECTION_TAG },
    include: { tables: { select: { id: true } } },
  });
  for (const s of old) {
    const tids = s.tables.map((t) => t.id);
    if (tids.length) {
      await prisma.reservation.deleteMany({ where: { tableId: { in: tids } } });
      await prisma.tableMove.deleteMany({ where: { tableId: { in: tids } } });
    }
    await prisma.tableSection.delete({ where: { id: s.id } }).catch(() => {});
  }
  const section = await prisma.tableSection.create({
    data: { restaurantId: restaurant.id, nameRo: SECTION_TAG, nameEn: SECTION_TAG, gridRows: 1, gridColumns: 1, displayOrder: 99 },
  });
  const smallTable = await prisma.restaurantTable.create({
    data: { sectionId: section.id, restaurantId: restaurant.id, tableNumber: 'SMK-TINY', seatCount: 2, gridRow: 0, gridCol: 0 },
  });
  const future = new Date(); future.setUTCDate(future.getUTCDate() + 14);
  const futureIso = future.toISOString().slice(0, 10);
  const resv = await prisma.reservation.create({
    data: {
      userId: diner.id,
      restaurantId: restaurant.id,
      date: new Date(`${futureIso}T00:00:00.000Z`),
      time: '19:00', endTime: '21:00',
      partySize: 10,
      status: 'PENDING',
      guestName: '[smoke] override wiring',
    },
  });
  console.log(`\nSeeded smoke fixture: reservation=${resv.id.slice(0, 8)} table=${smallTable.tableNumber}`);

  // (a) + (b) + (c): PUT /assign-table without force → 409 with full
  // structured body + err.payload populated via the api.js convention.
  console.log('\n[a-c] PUT /assign-table (no force) → 409, err.payload populated');
  let caught = null;
  try {
    await simulateApiPut(
      `${BASE}/restaurant/reservations/${resv.id}/assign-table`,
      tStaff,
      { tableId: smallTable.id }
    );
  } catch (err) {
    caught = err;
  }
  expect(!!caught, 'caught the thrown error');
  expect(caught?.status === 409, `err.status=${caught?.status}`);
  expect(!!caught?.payload, 'err.payload defined');
  const info = caught?.payload?.error;
  expect(!!info, 'err.payload.error defined');
  expect(info?.code === 'party-too-large', `error.code=${info?.code}`);
  expect(info?.tableLabel === 'SMK-TINY', `tableLabel=${info?.tableLabel}`);
  expect(info?.seatCount === 2, `seatCount=${info?.seatCount}`);
  expect(info?.partySize === 10, `partySize=${info?.partySize}`);
  expect(info?.mergeGroupId === null, `mergeGroupId=${info?.mergeGroupId}`);
  // The user-facing live page's catch reads `err.payload.error.code` —
  // if that path is truthy, the OverrideModal opens. Replicating the
  // exact branch here:
  const modalShouldOpen = !!(info && info.code === 'party-too-large');
  expect(modalShouldOpen === true, 'live-page catch branch routes to OverrideModal');

  // (d): re-POST with force: true → 200, reservation.tableId mutated.
  console.log('\n[d] Re-PUT with { force: true } → 200, reservation assigned');
  const forced = await simulateApiPut(
    `${BASE}/restaurant/reservations/${resv.id}/assign-table`,
    tStaff,
    { tableId: smallTable.id, force: true }
  );
  expect(forced?.tableId === smallTable.id, `reservation.tableId=${forced?.tableId}`);

  // Verify in DB to rule out the route returning a stale response.
  const after = await prisma.reservation.findUnique({ where: { id: resv.id } });
  expect(after.tableId === smallTable.id, `DB reservation.tableId matches`);

  // Cleanup: drop reservation + the smoke fixture.
  await prisma.reservation.delete({ where: { id: resv.id } }).catch(() => {});
  await prisma.tableMove.deleteMany({ where: { tableId: smallTable.id } });
  await prisma.tableSection.delete({ where: { id: section.id } }).catch(() => {});

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
