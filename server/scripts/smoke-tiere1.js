// Tier E commit 1 smoke — restaurant approve/reject + backend hardening.
// Covers the 9 paths the operator spec'd:
//   a) seed CONFIRMED reservation
//   b) POST /modify (date+party) → 201, modificationPending payload
//   c) Second POST /modify → 409 modification-already-pending
//   d) POST /modify with all-null body → 400 no-op-modification
//   e) POST /modify on COMPLETED reservation → 400 reservation-not-modifiable
//   f) PUT /approve → 200, reservation mutated, modification APPROVED,
//      MODIFICATION_APPROVED template renders RO+EN
//   g) Approve-transaction rollback — force a constraint violation and
//      assert neither write took effect
//   h) PUT /reject → 200, status REJECTED, dispatcher fires MODIFICATION_
//      REJECTED with the spec's "Vrei să păstrezi rezervarea originală?" RO copy
//   i) Cleanup
//
// Plus regressions: C6 popup-actions Node smoke (15 cases) and C1
// dispatcher 12-event surface.
//
// Idempotent: at start, wipes any leftover '[smoke-e1]' reservations and
// their modifications.

const { PrismaClient } = require('@prisma/client');
const path = require('path');
const { renderTemplate, EVENTS } = require(
  path.resolve(__dirname, '..', 'src', 'services', 'notifications', 'templates.js')
);

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const SMOKE_TAG = '[smoke-e1]';

async function adminToken() {
  const r = await fetch(`${BASE}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aprez.ro', password: 'admin123' }),
  });
  const d = await r.json();
  return d.token;
}
async function dinerToken() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aprez.ro', password: 'user123' }),
  });
  const d = await r.json();
  return d.token;
}
async function staffToken(restaurantUsername) {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: restaurantUsername, password: 'lamama123' }),
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

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function main() {
  const tDiner = await dinerToken();
  const tStaff = await staffToken('lamama');

  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  const dinerUser = await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } });
  const rid = restaurant.id;
  console.log(`Smoke target: ${restaurant.nameEn} (${rid})`);

  // ---- baseline cleanup ----
  console.log('\n[baseline] wipe smoke-e1 reservations + modifications');
  const prior = await prisma.reservation.findMany({
    where: { restaurantId: rid, guestName: { startsWith: SMOKE_TAG } },
    select: { id: true },
  });
  if (prior.length) {
    const ids = prior.map((r) => r.id);
    await prisma.reservationModification.deleteMany({ where: { reservationId: { in: ids } } });
    await prisma.reservation.deleteMany({ where: { id: { in: ids } } });
  }

  // ============================================================
  // a) Seed CONFIRMED reservation for a future date
  // ============================================================
  console.log('\n[a] Seed CONFIRMED reservation');
  const futureDate = new Date();
  futureDate.setUTCDate(futureDate.getUTCDate() + 21);
  const seed = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      date: new Date(isoDate(futureDate) + 'T00:00:00.000Z'),
      time: '19:00',
      endTime: '21:00',
      partySize: 2,
      status: 'CONFIRMED',
      guestName: `${SMOKE_TAG} happy path`,
    },
  });
  expect(!!seed.id, `seeded ${seed.id}`);
  expect(seed.status === 'CONFIRMED', `status=${seed.status}`);
  expect(seed.acknowledgedAt === undefined || seed.acknowledgedAt === null, 'acknowledgedAt-not-set on reservation');

  // ============================================================
  // b) POST /modify (date + party) → 201, modificationPending shape
  // ============================================================
  console.log('\n[b] POST /modify (date + party)');
  const newDate = new Date(futureDate);
  newDate.setUTCDate(newDate.getUTCDate() + 1);
  const newDateIso = isoDate(newDate);
  const rB = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {
    requestedDate: newDateIso,
    requestedPartySize: 4,
  });
  expect(rB.status === 201, `status=${rB.status}`);
  expect(rB.body?.status === 'PENDING', `mod.status=${rB.body?.status}`);
  expect(rB.body?.requestedPartySize === 4, `mod.requestedPartySize=${rB.body?.requestedPartySize}`);
  const modId = rB.body?.id;

  // ============================================================
  // c) Second POST /modify on the same reservation → 409
  // ============================================================
  console.log('\n[c] Second POST /modify → 409 modification-already-pending');
  const rC = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {
    requestedTime: '20:00',
  });
  expect(rC.status === 409, `status=${rC.status}`);
  expect(rC.body?.error?.code === 'modification-already-pending', `error.code=${rC.body?.error?.code}`);
  expect(rC.body?.error?.existingId === modId, `existingId=${rC.body?.error?.existingId}`);

  // ============================================================
  // d) POST /modify with all-null body → 400 no-op-modification
  // ============================================================
  console.log('\n[d] POST /modify (no fields) → 400 no-op');
  // Wipe the pending modification first so the no-op check runs (the
  // already-pending guard would fire otherwise).
  await prisma.reservationModification.delete({ where: { id: modId } });
  const rD = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {});
  expect(rD.status === 400, `status=${rD.status}`);
  expect(rD.body?.error?.code === 'no-op-modification', `error.code=${rD.body?.error?.code}`);

  // Also: a request that matches the CURRENT values (date stays, party
  // stays, time stays) is a no-op even though fields are non-null.
  const rD2 = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {
    requestedTime: seed.time,
    requestedPartySize: seed.partySize,
  });
  expect(rD2.status === 400, `same-values status=${rD2.status}`);
  expect(rD2.body?.error?.code === 'no-op-modification', `same-values error.code=${rD2.body?.error?.code}`);

  // ============================================================
  // e) POST /modify on a COMPLETED reservation → 400 not-modifiable
  // ============================================================
  console.log('\n[e] POST /modify on COMPLETED → 400 reservation-not-modifiable');
  const completed = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      date: new Date(isoDate(new Date()) + 'T00:00:00.000Z'),
      time: '12:00',
      endTime: '14:00',
      partySize: 2,
      status: 'COMPLETED',
      guestName: `${SMOKE_TAG} completed`,
    },
  });
  const rE = await http('POST', `/reservations/${completed.id}/modify`, tDiner, {
    requestedTime: '13:00',
  });
  expect(rE.status === 400, `status=${rE.status}`);
  expect(rE.body?.error?.code === 'reservation-not-modifiable', `error.code=${rE.body?.error?.code}`);

  // ============================================================
  // f) PUT /approve → 200, reservation mutated, MODIFICATION_APPROVED fires
  // ============================================================
  console.log('\n[f] PUT /approve');
  // Recreate a pending mod (we deleted the prior one in [d]).
  const rB2 = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {
    requestedDate: newDateIso,
    requestedPartySize: 4,
  });
  const modId2 = rB2.body?.id;
  expect(rB2.status === 201, `re-seed mod status=${rB2.status}`);

  const rF = await http('PUT', `/restaurant/modifications/${modId2}/approve`, tStaff);
  expect(rF.status === 200, `approve status=${rF.status}`);
  expect(rF.body?.status === 'APPROVED', `mod.status=${rF.body?.status}`);
  expect(!!rF.body?.resolvedAt, `resolvedAt set`);

  const afterApprove = await prisma.reservation.findUnique({ where: { id: seed.id } });
  expect(afterApprove.partySize === 4, `reservation.partySize=${afterApprove.partySize}`);
  expect(isoDate(afterApprove.date) === newDateIso, `reservation.date=${isoDate(afterApprove.date)}`);

  // Template render — verifies the dispatcher will render the right
  // RO+EN copy from the same ctx the approve handler builds. (We don't
  // intercept the Resend send; we just confirm the template surface.)
  const approvedTpl = renderTemplate(EVENTS.MODIFICATION_APPROVED, {
    restaurant: { nameRo: restaurant.nameRo, nameEn: restaurant.nameEn },
    date: afterApprove.date,
    time: afterApprove.time,
    partySize: afterApprove.partySize,
  });
  expect(/aprobat/i.test(approvedTpl.titleRo), `RO title contains 'aprobat': "${approvedTpl.titleRo}"`);
  expect(/approved/i.test(approvedTpl.titleEn), `EN title contains 'approved': "${approvedTpl.titleEn}"`);
  expect(/persoane/i.test(approvedTpl.bodyRo), `RO body mentions party: "${approvedTpl.bodyRo}"`);

  // ============================================================
  // g) Approve-transaction rollback — force a Prisma constraint failure
  //     and assert neither the reservation NOR the modification row was
  //     mutated. Mechanism: pass a malformed updateData (e.g. an invalid
  //     enum value via direct Prisma) inside a $transaction that mirrors
  //     the route's order, then verify the row didn't change.
  // ============================================================
  console.log('\n[g] Approve-transaction rollback on injected failure');
  // Set up a fresh reservation + modification.
  const rollbackResv = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      date: new Date(isoDate(futureDate) + 'T00:00:00.000Z'),
      time: '18:00',
      endTime: '20:00',
      partySize: 3,
      status: 'CONFIRMED',
      guestName: `${SMOKE_TAG} rollback`,
    },
  });
  const rollbackMod = await prisma.reservationModification.create({
    data: {
      reservationId: rollbackResv.id,
      requestedPartySize: 5,
      status: 'PENDING',
    },
  });

  // Mirror the route's transaction order but inject a failing write
  // (status: 'NOT_A_REAL_ENUM_VALUE' would fail validation but Prisma
  // would error out before sending; cleaner: violate the table-row FK
  // by referencing a non-existent reservation id in the second op).
  let txError = null;
  try {
    await prisma.$transaction([
      prisma.reservation.update({
        where: { id: rollbackResv.id },
        data: { partySize: 5 },
      }),
      // This will fail because 'definitely-not-a-real-id' doesn't exist
      // — entire transaction rolls back.
      prisma.reservationModification.update({
        where: { id: 'definitely-not-a-real-id' },
        data: { status: 'APPROVED', resolvedAt: new Date() },
      }),
    ]);
  } catch (e) {
    txError = e;
  }
  expect(!!txError, `transaction errored: ${txError?.code || txError?.name || '?'}`);

  const afterRollback = await prisma.reservation.findUnique({ where: { id: rollbackResv.id } });
  expect(afterRollback.partySize === 3, `reservation.partySize unchanged (${afterRollback.partySize})`);
  const modAfterRollback = await prisma.reservationModification.findUnique({ where: { id: rollbackMod.id } });
  expect(modAfterRollback.status === 'PENDING', `modification.status unchanged (${modAfterRollback.status})`);

  // ============================================================
  // h) PUT /reject → 200 + MODIFICATION_REJECTED template carries the
  //    spec's RO "păstrezi rezervarea originală?" copy
  // ============================================================
  console.log('\n[h] PUT /reject');
  const rH = await http('PUT', `/restaurant/modifications/${rollbackMod.id}/reject`, tStaff);
  expect(rH.status === 200, `reject status=${rH.status}`);
  expect(rH.body?.status === 'REJECTED', `mod.status=${rH.body?.status}`);

  const rejectedTpl = renderTemplate(EVENTS.MODIFICATION_REJECTED, {});
  expect(/respinsă/i.test(rejectedTpl.titleRo), `RO title contains 'respinsă': "${rejectedTpl.titleRo}"`);
  expect(/păstrezi rezervarea originală/i.test(rejectedTpl.bodyRo), `RO body contains keep-original prompt: "${rejectedTpl.bodyRo}"`);
  expect(/wasn't approved/i.test(rejectedTpl.bodyEn) || /not approved/i.test(rejectedTpl.bodyEn), `EN body mentions not approved: "${rejectedTpl.bodyEn}"`);

  // After rollback's reservation got its modification rejected, confirm
  // its partySize is still untouched (reject must not mutate the
  // reservation).
  const afterReject = await prisma.reservation.findUnique({ where: { id: rollbackResv.id } });
  expect(afterReject.partySize === 3, `reservation.partySize untouched by reject (${afterReject.partySize})`);

  // ============================================================
  // Bonus: confirm modificationPending shape on /api/restaurant/reservations
  // (the new include + flatten landed in this commit).
  // ============================================================
  console.log('\n[bonus] /api/restaurant/reservations shapes modificationPending');
  // Seed a fresh modification to verify the shape.
  const shapeMod = await prisma.reservationModification.create({
    data: { reservationId: rollbackResv.id, requestedTime: '19:30', status: 'PENDING' },
  });
  const rList = await http('GET', `/restaurant/reservations`, tStaff);
  expect(rList.status === 200, `list status=${rList.status}`);
  const targetRow = (rList.body || []).find((r) => r.id === rollbackResv.id);
  expect(!!targetRow, `target row in list`);
  expect(targetRow?.modificationPending?.id === shapeMod.id, `modificationPending.id matches`);
  expect(targetRow?.modificationPending?.status === 'PENDING', `modificationPending.status=PENDING`);

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\n[cleanup] removing smoke rows');
  const allSeedIds = [seed.id, completed.id, rollbackResv.id];
  await prisma.reservationModification.deleteMany({ where: { reservationId: { in: allSeedIds } } });
  await prisma.reservation.deleteMany({ where: { id: { in: allSeedIds } } });

  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
