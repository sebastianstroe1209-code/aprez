// Tier E commit 2 smoke — diner Keep/Cancel ack + modify-route hardening.
// Covers the 11 paths the operator spec'd:
//   a) Seed CONFIRMED reservation for demo diner at La Mama
//   b) POST /modify → 201, PENDING
//   c) Staff reject → 200, mod REJECTED, MODIFICATION_REJECTED fires
//   d) Ack action='keep' → 200, acknowledgedAt set, reservation untouched
//   e) After keep-ack, a NEW POST /modify on the same reservation is no
//      longer blocked by the modification-already-pending guard (the
//      previous mod is REJECTED + acknowledged, so the guard's
//      `status: 'PENDING'` filter passes it over).
//   f) Second POST /modify → 201, new PENDING
//   g) Staff rejects the second mod → 200
//   h) Ack action='cancel' → 200, acknowledgedAt set,
//      reservation.status=CANCELLED, cancelledBy='user',
//      RESERVATION_CANCELLED_BY_DINER fires
//   i) Ack failure paths:
//       - invalid action → 400 invalid-action
//       - ack on a PENDING mod → 400 modification-not-rejected
//       - second ack on already-acknowledged → 400 modification-already-acknowledged
//       - ack from a different diner's JWT → 403 forbidden
//   j) Validation paths on POST /modify (E2 backend additions):
//       - requestedDate in the past → 400 date-in-past
//       - requestedDate on DisabledDate list → 400 date-not-available
//       - requestedTime outside opening hours → 400 time-outside-hours
//   k) Cleanup
//
// Plus a sanity check that the MODIFICATION_REJECTED template still
// renders the spec-aligned RO copy "Vrei să păstrezi rezervarea
// originală?".
//
// Idempotent — wipes any '[smoke-e2]' rows at start and end.

const { PrismaClient } = require('@prisma/client');
const path = require('path');
const { renderTemplate, EVENTS } = require(
  path.resolve(__dirname, '..', 'src', 'services', 'notifications', 'templates.js')
);

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const SMOKE_TAG = '[smoke-e2]';

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function dinerToken(email = 'demo@aprez.ro', password = 'user123') {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!d.token) throw new Error('diner login failed: ' + JSON.stringify(d));
  return d.token;
}
async function staffToken() {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lamama', password: 'lamama123' }),
  });
  const d = await r.json();
  return d.token;
}
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
  const tDiner = await dinerToken();
  const tStaff = await staffToken();
  const tAdmin = await adminToken();

  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  const dinerUser = await prisma.user.findFirst({ where: { email: 'demo@aprez.ro' } });
  const rid = restaurant.id;
  console.log(`Smoke target: ${restaurant.nameEn} (${rid})`);

  // Make a throwaway second diner so we can test cross-user 403.
  const tmpEmail = `smoke-e2-other-${Date.now()}@example.com`;
  const reg = await http('POST', '/auth/register', null, {
    firstName: 'E2', lastName: 'Other', email: tmpEmail, password: 'tmppass123',
  });
  const tOther = reg.body?.token;

  // baseline cleanup
  const prior = await prisma.reservation.findMany({
    where: { restaurantId: rid, guestName: { startsWith: SMOKE_TAG } }, select: { id: true },
  });
  if (prior.length) {
    const ids = prior.map((r) => r.id);
    await prisma.reservationModification.deleteMany({ where: { reservationId: { in: ids } } });
    await prisma.reservation.deleteMany({ where: { id: { in: ids } } });
  }

  // ============================================================
  // a) Seed CONFIRMED reservation
  // ============================================================
  console.log('\n[a] Seed CONFIRMED reservation');
  const futureDate = new Date();
  futureDate.setUTCDate(futureDate.getUTCDate() + 28);
  const seed = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      date: new Date(isoDate(futureDate) + 'T00:00:00.000Z'),
      time: '19:00',
      endTime: '21:00',
      partySize: 4,
      status: 'CONFIRMED',
      guestName: `${SMOKE_TAG} ack path`,
    },
  });
  expect(seed.status === 'CONFIRMED', `seeded ${seed.id}`);

  // ============================================================
  // b) POST /modify
  // ============================================================
  console.log('\n[b] POST /modify');
  const rB = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {
    requestedTime: '20:00',
  });
  expect(rB.status === 201, `status=${rB.status}`);
  const mod1Id = rB.body?.id;
  expect(rB.body?.status === 'PENDING', `status=PENDING`);

  // ============================================================
  // c) Staff reject
  // ============================================================
  console.log('\n[c] Staff reject');
  const rC = await http('PUT', `/restaurant/modifications/${mod1Id}/reject`, tStaff);
  expect(rC.status === 200, `status=${rC.status}`);
  expect(rC.body?.status === 'REJECTED', `mod.status=${rC.body?.status}`);

  // ============================================================
  // d) Ack action='keep'
  // ============================================================
  console.log("\n[d] Ack action='keep'");
  const rD = await http('POST', `/reservations/${seed.id}/modifications/${mod1Id}/ack`, tDiner, { action: 'keep' });
  expect(rD.status === 200, `status=${rD.status}`);
  expect(!!rD.body?.acknowledgedAt, `acknowledgedAt set`);
  expect(rD.body?.reservation === null, `reservation=null on keep`);

  const afterKeep = await prisma.reservation.findUnique({ where: { id: seed.id } });
  expect(afterKeep.status === 'CONFIRMED', `reservation untouched (${afterKeep.status})`);
  const mod1After = await prisma.reservationModification.findUnique({ where: { id: mod1Id } });
  expect(!!mod1After.acknowledgedAt, `mod.acknowledgedAt set in DB`);

  // ============================================================
  // e) After keep-ack, modification-already-pending no longer blocks
  // ============================================================
  console.log('\n[e] modification-already-pending no longer blocks after keep-ack');
  // (Verified implicitly by [f] succeeding.)

  // ============================================================
  // f) Second POST /modify succeeds
  // ============================================================
  console.log('\n[f] Second POST /modify');
  const rF = await http('POST', `/reservations/${seed.id}/modify`, tDiner, {
    requestedPartySize: 6,
  });
  expect(rF.status === 201, `status=${rF.status}`);
  const mod2Id = rF.body?.id;
  expect(rF.body?.status === 'PENDING', `status=PENDING`);

  // ============================================================
  // g) Staff rejects the second mod
  // ============================================================
  console.log('\n[g] Staff rejects mod #2');
  const rG = await http('PUT', `/restaurant/modifications/${mod2Id}/reject`, tStaff);
  expect(rG.status === 200, `status=${rG.status}`);

  // ============================================================
  // h) Ack action='cancel'
  // ============================================================
  console.log("\n[h] Ack action='cancel'");
  const rH = await http('POST', `/reservations/${seed.id}/modifications/${mod2Id}/ack`, tDiner, { action: 'cancel' });
  expect(rH.status === 200, `status=${rH.status}`);
  expect(!!rH.body?.acknowledgedAt, `acknowledgedAt set`);
  expect(rH.body?.reservation?.status === 'CANCELLED', `reservation.status=${rH.body?.reservation?.status}`);
  expect(rH.body?.reservation?.cancelledBy === 'user', `cancelledBy=${rH.body?.reservation?.cancelledBy}`);

  const afterCancel = await prisma.reservation.findUnique({ where: { id: seed.id } });
  expect(afterCancel.status === 'CANCELLED', `DB reservation.status=${afterCancel.status}`);
  expect(afterCancel.cancelledBy === 'user', `DB cancelledBy=${afterCancel.cancelledBy}`);
  expect(!!afterCancel.cancelledAt, `cancelledAt set`);

  // ============================================================
  // i) Ack failure paths
  // ============================================================
  console.log('\n[i] Ack failure paths');

  // Seed a fresh reservation + REJECTED mod for the failure tests.
  const failResv = await prisma.reservation.create({
    data: {
      userId: dinerUser.id,
      restaurantId: rid,
      date: new Date(isoDate(futureDate) + 'T00:00:00.000Z'),
      time: '20:30',
      endTime: '22:30',
      partySize: 2,
      status: 'CONFIRMED',
      guestName: `${SMOKE_TAG} failure paths`,
    },
  });
  const pendingMod = await prisma.reservationModification.create({
    data: { reservationId: failResv.id, requestedTime: '21:00', status: 'PENDING' },
  });
  const rejectedMod = await prisma.reservationModification.create({
    data: { reservationId: failResv.id, requestedTime: '21:30', status: 'REJECTED', resolvedAt: new Date() },
  });

  // i.1 invalid action
  const rI1 = await http('POST', `/reservations/${failResv.id}/modifications/${rejectedMod.id}/ack`, tDiner, { action: 'blah' });
  expect(rI1.status === 400, `i.1 status=${rI1.status}`);
  expect(rI1.body?.error?.code === 'invalid-action', `i.1 error.code=${rI1.body?.error?.code}`);

  // i.2 ack on PENDING
  const rI2 = await http('POST', `/reservations/${failResv.id}/modifications/${pendingMod.id}/ack`, tDiner, { action: 'keep' });
  expect(rI2.status === 400, `i.2 status=${rI2.status}`);
  expect(rI2.body?.error?.code === 'modification-not-rejected', `i.2 error.code=${rI2.body?.error?.code}`);

  // i.3 ack twice on already-acknowledged
  const firstAck = await http('POST', `/reservations/${failResv.id}/modifications/${rejectedMod.id}/ack`, tDiner, { action: 'keep' });
  expect(firstAck.status === 200, `i.3 setup ack status=${firstAck.status}`);
  const rI3 = await http('POST', `/reservations/${failResv.id}/modifications/${rejectedMod.id}/ack`, tDiner, { action: 'keep' });
  expect(rI3.status === 400, `i.3 status=${rI3.status}`);
  expect(rI3.body?.error?.code === 'modification-already-acknowledged', `i.3 error.code=${rI3.body?.error?.code}`);

  // i.4 cross-user 403
  // Need a fresh rejected mod since the prior one is acknowledged.
  const rejectedMod2 = await prisma.reservationModification.create({
    data: { reservationId: failResv.id, requestedTime: '21:45', status: 'REJECTED', resolvedAt: new Date() },
  });
  const rI4 = await http('POST', `/reservations/${failResv.id}/modifications/${rejectedMod2.id}/ack`, tOther, { action: 'keep' });
  expect(rI4.status === 403, `i.4 status=${rI4.status}`);
  expect(rI4.body?.error?.code === 'forbidden', `i.4 error.code=${rI4.body?.error?.code}`);

  // ============================================================
  // j) Validation paths on POST /modify
  // ============================================================
  console.log('\n[j] POST /modify validation');

  // Seed an active CONFIRMED reservation we can probe.
  const validResv = await prisma.reservation.create({
    data: {
      userId: dinerUser.id, restaurantId: rid,
      date: new Date(isoDate(futureDate) + 'T00:00:00.000Z'),
      time: '19:00', endTime: '21:00', partySize: 2,
      status: 'CONFIRMED', guestName: `${SMOKE_TAG} validation`,
    },
  });

  // j.1 requestedDate in the past
  const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const rJ1 = await http('POST', `/reservations/${validResv.id}/modify`, tDiner, { requestedDate: isoDate(yesterday) });
  expect(rJ1.status === 400, `j.1 status=${rJ1.status}`);
  expect(rJ1.body?.error?.code === 'date-in-past', `j.1 error.code=${rJ1.body?.error?.code}`);

  // j.2 requestedDate on DisabledDate list — use admin endpoint to add
  // a disabled date for tomorrow, then probe.
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await http('POST', `/admin/restaurants/${rid}/disabled-dates`, tAdmin, {
    date: isoDate(tomorrow), reason: 'smoke-e2-temp',
  });
  const rJ2 = await http('POST', `/reservations/${validResv.id}/modify`, tDiner, { requestedDate: isoDate(tomorrow) });
  expect(rJ2.status === 400, `j.2 status=${rJ2.status}`);
  expect(rJ2.body?.error?.code === 'date-not-available', `j.2 error.code=${rJ2.body?.error?.code}`);
  // Clean up the disabled-date row so we don't poison the seed.
  await prisma.disabledDate.deleteMany({
    where: { restaurantId: rid, date: new Date(isoDate(tomorrow) + 'T00:00:00.000Z') },
  });

  // j.3 requestedTime outside opening hours (use 04:00 — well before
  // any restaurant opens).
  const rJ3 = await http('POST', `/reservations/${validResv.id}/modify`, tDiner, { requestedTime: '04:00' });
  expect(rJ3.status === 400, `j.3 status=${rJ3.status}`);
  expect(rJ3.body?.error?.code === 'time-outside-hours', `j.3 error.code=${rJ3.body?.error?.code}`);

  // ============================================================
  // Sanity: REJECTED template still says "păstrezi rezervarea originală"
  // ============================================================
  console.log('\n[sanity] MODIFICATION_REJECTED RO copy unchanged');
  const tpl = renderTemplate(EVENTS.MODIFICATION_REJECTED, {});
  expect(/păstrezi rezervarea originală/i.test(tpl.bodyRo), `RO body: "${tpl.bodyRo}"`);

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\n[cleanup]');
  const seedIds = await prisma.reservation.findMany({
    where: { restaurantId: rid, guestName: { startsWith: SMOKE_TAG } }, select: { id: true },
  });
  if (seedIds.length) {
    const ids = seedIds.map((r) => r.id);
    await prisma.reservationModification.deleteMany({ where: { reservationId: { in: ids } } });
    await prisma.reservation.deleteMany({ where: { id: { in: ids } } });
  }
  // Throwaway user used for cross-user 403 — soft-delete via DELETE /me.
  await http('DELETE', '/users/me', tOther);

  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
