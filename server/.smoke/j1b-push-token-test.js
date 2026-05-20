// Tier J launch-fix 1b — push-token registration + push-channel
// re-verification (SPEC §5.7 / §10).
//
// The mobile half (expo-notifications, permission flow, token upload)
// is device-only and not smoke-testable here. What IS verifiable
// server-side, and what this re-confirms, is the contract the mobile
// app now drives:
//
//   [a] PUT /api/users/me/push-token (valid token) → 200; the diner's
//       User.expoPushToken column is populated.
//   [b] A second PUT with a different token → 200; the row rotates.
//   [c] PUT with an empty token → 400 (the min-length guard).
//   [d] sendPush() with no token → null (skip — the §10 SMS fallback
//       chain owns delivery for a push-less user).
//   [e] sendPush() with a malformed token → null (skip, bad format).
//   [f] sendPush() with a pattern-valid token → non-null result — the
//       Tier C3 Expo Push transport actually runs (posts to exp.host
//       and returns a ticket or a handled error; never the null skip).
//
// Requires the backend on :4000. Uses the demo diner; resets its
// expoPushToken to null and drops smoke Notification rows at the end.

const { PrismaClient } = require('@prisma/client');
const { sendPush } = require('../src/services/notifications/channels/push');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const TOKEN_1 = 'ExponentPushToken[smoke-j1b-aaaaaaaaaaaa]';
const TOKEN_2 = 'ExponentPushToken[smoke-j1b-bbbbbbbbbbbb]';
const CONTENT = { titleRo: 'Test RO', titleEn: 'Test EN', bodyRo: 'Corp RO', bodyEn: 'Body EN' };

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

async function main() {
  const login = await http('POST', '/auth/login', null, { email: 'demo@aprez.ro', password: 'user123' });
  const token = login.body?.token;
  const userId = login.body?.user?.id;
  expect(!!token && !!userId, `diner login → token + userId (${userId})`);

  console.log('\n[a] PUT /users/me/push-token — valid token populates the column');
  const a = await http('PUT', '/users/me/push-token', token, { expoPushToken: TOKEN_1 });
  expect(a.status === 200, `status=200 (got ${a.status})`);
  let row = await prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
  expect(row?.expoPushToken === TOKEN_1, `User.expoPushToken populated (got ${row?.expoPushToken})`);

  console.log('\n[b] PUT again with a different token — row rotates');
  const b = await http('PUT', '/users/me/push-token', token, { expoPushToken: TOKEN_2 });
  expect(b.status === 200, `status=200 (got ${b.status})`);
  row = await prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
  expect(row?.expoPushToken === TOKEN_2, `User.expoPushToken rotated (got ${row?.expoPushToken})`);

  console.log('\n[c] PUT with an empty token → 400');
  const c = await http('PUT', '/users/me/push-token', token, { expoPushToken: '' });
  expect(c.status === 400, `status=400 (got ${c.status})`);

  console.log('\n[d] sendPush() with no token → null (skip)');
  const d = await sendPush(prisma, null, {
    recipientType: 'user', userId, eventKey: 'smoke-j1b', expoPushToken: null, content: CONTENT, lang: 'en',
  });
  expect(d === null, `returned null (got ${JSON.stringify(d)})`);

  console.log('\n[e] sendPush() with a malformed token → null (skip)');
  const e = await sendPush(prisma, null, {
    recipientType: 'user', userId, eventKey: 'smoke-j1b', expoPushToken: 'not-a-real-token', content: CONTENT, lang: 'en',
  });
  expect(e === null, `returned null (got ${JSON.stringify(e)})`);

  console.log('\n[f] sendPush() with a pattern-valid token → C3 transport runs (non-null)');
  const f = await sendPush(prisma, null, {
    recipientType: 'user', userId, eventKey: 'smoke-j1b', expoPushToken: TOKEN_1, content: CONTENT, lang: 'en',
  });
  expect(f !== null && f !== undefined, `transport executed — non-null result (got ${JSON.stringify(f)?.slice(0, 80)})`);

  console.log('\n[cleanup] reset demo expoPushToken + drop smoke notifications');
  await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { type: 'smoke-j1b' } }).catch(() => {});

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
