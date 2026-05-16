// Tier D commit 2 smoke — covers all 5 paths the user asked for:
//   1. POST /auth/diner/forgot-password (existing email) → 200 neutral
//   2. POST /auth/diner/reset-password with the real token → 200 + login works
//   3. POST /me/phone-prompt-seen → stamps the dismissal column
//   4. DELETE /me → anonymizes reservations + soft-deletes user
//   5. Old JWT after deletion → 401 (auth middleware rejects)
// Plus a regression spot-check that the restaurant-side reset path still
// works (Tier D commit 1 didn't break under the new auth-middleware guard).
//
// Designed to run idempotently against the demo seed. Resets demo@aprez.ro
// back to its original "user123" password at the end so re-running the
// script never leaves the seed in a broken state.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const ORIGINAL_PASSWORD = 'user123';
const NEW_PASSWORD = 'reset-by-smoke-9876';

async function http(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch (_) { payload = null; }
  return { status: res.status, body: payload };
}

function expect(cond, label) {
  if (cond) {
    console.log(`  PASS — ${label}`);
  } else {
    console.error(`  FAIL — ${label}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n[1] Diner forgot-password (existing email) → neutral 200');
  const r1 = await http('POST', '/auth/diner/forgot-password', { body: { email: 'demo@aprez.ro' } });
  expect(r1.status === 200, `status=${r1.status}`);
  expect(/sent a reset link/i.test(r1.body?.message || ''), `neutral copy: ${r1.body?.message}`);

  console.log('\n[2] Diner reset-password with real token from DB');
  const token = await prisma.passwordResetToken.findFirst({
    where: { userType: 'user', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  expect(!!token, `latest unused diner token exists: id=${token?.id}`);
  if (!token) { await prisma.$disconnect(); return; }

  const r2 = await http('POST', '/auth/diner/reset-password', {
    body: { token: token.token, newPassword: NEW_PASSWORD },
  });
  expect(r2.status === 200, `reset status=${r2.status}`);

  const r2b = await http('POST', '/auth/login', { body: { email: 'demo@aprez.ro', password: NEW_PASSWORD } });
  expect(r2b.status === 200, `login with new password status=${r2b.status}`);
  const dinerToken = r2b.body?.token;
  expect(!!dinerToken, `got JWT from login: ${dinerToken ? 'yes' : 'NO'}`);

  // Token can't be re-used
  const r2c = await http('POST', '/auth/diner/reset-password', {
    body: { token: token.token, newPassword: 'another-pw-345' },
  });
  expect(r2c.status === 400 && r2c.body?.error?.code === 'token-used', `re-use blocked: ${r2c.body?.error?.code}`);

  // Bad token rejected
  const r2d = await http('POST', '/auth/diner/reset-password', {
    body: { token: 'definitely-not-a-real-token', newPassword: 'something' },
  });
  expect(r2d.status === 400 && r2d.body?.error?.code === 'invalid-token', `bad token rejected: ${r2d.body?.error?.code}`);

  console.log('\n[3] POST /users/me/phone-prompt-seen stamps the column');
  // Clear the column first so the smoke is repeatable.
  await prisma.user.updateMany({ where: { email: 'demo@aprez.ro' }, data: { phonePromptSeenAt: null } });
  const r3 = await http('POST', '/users/me/phone-prompt-seen', { token: dinerToken });
  expect(r3.status === 200, `status=${r3.status}`);
  expect(!!r3.body?.phonePromptSeenAt, `column set: ${r3.body?.phonePromptSeenAt}`);

  console.log('\n[4] DELETE /users/me — anonymize + soft-delete');
  // Spin up a throwaway diner so we don't actually nuke the seed user.
  const tmpEmail = `smoke-delete-${Date.now()}@example.com`;
  const reg = await http('POST', '/auth/register', {
    body: { firstName: 'Smoke', lastName: 'Delete', email: tmpEmail, password: 'tmppass123' },
  });
  expect(reg.status === 201, `registered throwaway: ${reg.status}`);
  const tmpToken = reg.body?.token;
  const tmpId = reg.body?.user?.id;
  expect(!!tmpToken && !!tmpId, `got token + id`);

  // Give the throwaway user a reservation so we can confirm PII wipe.
  const someRestaurant = await prisma.restaurant.findFirst();
  expect(!!someRestaurant, `at least one restaurant in seed`);
  const resv = await prisma.reservation.create({
    data: {
      userId: tmpId,
      restaurantId: someRestaurant.id,
      date: new Date('2026-12-31'),
      time: '19:00',
      endTime: '21:00',
      partySize: 2,
      status: 'PENDING',
      guestName: 'Smoke Delete',
      guestEmail: tmpEmail,
      guestPhone: '+40700000001',
    },
  });

  const del = await http('DELETE', '/users/me', { token: tmpToken });
  expect(del.status === 200, `delete status=${del.status}`);

  const afterUser = await prisma.user.findUnique({ where: { id: tmpId } });
  expect(!!afterUser?.deletedAt, `deletedAt stamped`);
  expect(afterUser?.email === null, `email nulled (was ${afterUser?.email})`);
  expect(afterUser?.phone === null, `phone nulled`);
  expect(afterUser?.passwordHash === null, `passwordHash nulled`);

  const afterResv = await prisma.reservation.findUnique({ where: { id: resv.id } });
  expect(afterResv?.guestName === '[deleted account]', `reservation guestName anonymized (got "${afterResv?.guestName}")`);
  expect(afterResv?.guestEmail === null, `reservation guestEmail nulled`);
  expect(afterResv?.guestPhone === null, `reservation guestPhone nulled`);

  console.log('\n[5] Old JWT after deletion → 401 (account-deleted)');
  const r5 = await http('GET', '/users/me', { token: tmpToken });
  expect(r5.status === 401, `old token rejected: status=${r5.status}`);
  expect(r5.body?.error?.code === 'account-deleted', `error code: ${r5.body?.error?.code}`);

  // Idempotency: second DELETE on the already-deleted account using its
  // (still-locally-cached) token is rejected too, but let's check the
  // server-side branch by stamping a brand-new fake JWT manually instead.
  // Simpler: just verify the user.deletedAt flag is unchanged by another
  // DELETE attempt. We need a valid token for that, so the smoke ends here.

  console.log('\n[REG] Restaurant-side reset still works (no Tier D1 regression)');
  // Trigger a forgot for the seeded restaurant; verify token row created.
  const rrFor = await http('POST', '/auth/restaurant/forgot-password', { body: { usernameOrEmail: 'lamama' } });
  expect(rrFor.status === 200, `restaurant forgot status=${rrFor.status}`);
  // Confirm DB has a fresh restaurant-type token.
  const recentStaffToken = await prisma.passwordResetToken.findFirst({
    where: { userType: 'restaurant', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  expect(!!recentStaffToken, `restaurant token issued: id=${recentStaffToken?.id}`);

  console.log('\n[CLEANUP] Reset demo@aprez.ro password back to seed default');
  await prisma.user.update({
    where: { email: 'demo@aprez.ro' },
    data: {
      passwordHash: await bcrypt.hash(ORIGINAL_PASSWORD, 12),
      phonePromptSeenAt: null,
    },
  });
  console.log('  Done.');

  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  await prisma.$disconnect();
  process.exit(1);
});
