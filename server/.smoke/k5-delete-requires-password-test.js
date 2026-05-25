// Tier K5 — DELETE /users/me requires password re-auth.
//
// Pre-K5 a single JWT call wiped the account (verified in the audit —
// Cowork accidentally deleted demo@aprez.ro this way). A stolen device
// or XSS that grabs the JWT could destroy the account in one request.
//
// K5 makes the endpoint require body { password } and bcrypt-verifies
// against user.passwordHash before any destructive write.
//   missing password   → 403 { error: { code: 'password-required'  } }
//   wrong password     → 403 { error: { code: 'password-incorrect' } }
//   correct password   → 200, account soft-deleted as before.
//
//   [a] DELETE with no body                  → 403 + password-required.
//   [b] DELETE with body { password: '' }   → 403 + password-required.
//   [c] DELETE with wrong password           → 403 + password-incorrect.
//   [d] DELETE with correct password         → 200, user.deletedAt set.
//
// Requires the backend on :4000. Creates a throwaway diner, mutates,
// cleans up unconditionally.

const BASE = 'http://localhost:4000/api';
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

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
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

const RAND = Math.random().toString(36).slice(2, 8);
const EMAIL = `k5-${RAND}@example.com`;
const PASS = 'k5password';
let userId = null;

async function cleanup() {
  if (userId) {
    await prisma.reservation.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
}

async function main() {
  console.log('[reset] wipe rate-limit store (K3 brute-force would block our setup logins)');
  await http('POST', '/__test/reset-rate-limits', null, {});

  console.log('\n[setup] create throwaway diner + log in');
  const passwordHash = await bcrypt.hash(PASS, 12);
  const user = await prisma.user.create({
    data: { firstName: 'K5', lastName: 'Test', email: EMAIL, passwordHash },
  });
  userId = user.id;
  const login = await http('POST', '/auth/login', null, { email: EMAIL, password: PASS });
  const token = login.body?.token;
  expect(!!token, `login → token`);

  console.log('\n[a] DELETE with no body → 403 + password-required');
  const a = await http('DELETE', '/users/me', token, undefined);
  expect(a.status === 403, `status 403 (got ${a.status})`);
  expect(a.body?.error?.code === 'password-required',
    `error.code='password-required' (got ${JSON.stringify(a.body)?.slice(0, 120)})`);

  console.log('\n[b] DELETE with empty password → 403 + password-required');
  const b = await http('DELETE', '/users/me', token, { password: '' });
  expect(b.status === 403, `status 403 (got ${b.status})`);
  expect(b.body?.error?.code === 'password-required',
    `error.code='password-required' (got ${JSON.stringify(b.body)?.slice(0, 120)})`);

  console.log('\n[c] DELETE with wrong password → 403 + password-incorrect');
  const c = await http('DELETE', '/users/me', token, { password: 'wrongpass' });
  expect(c.status === 403, `status 403 (got ${c.status})`);
  expect(c.body?.error?.code === 'password-incorrect',
    `error.code='password-incorrect' (got ${JSON.stringify(c.body)?.slice(0, 120)})`);

  console.log('\n[d] DELETE with correct password → 200, user soft-deleted');
  const d = await http('DELETE', '/users/me', token, { password: PASS });
  expect(d.status === 200, `status 200 (got ${d.status})`);
  const after = await prisma.user.findUnique({ where: { id: userId } });
  expect(after?.deletedAt instanceof Date, `user.deletedAt is now set (got ${after?.deletedAt})`);

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main()
  .catch(async (err) => {
    console.error('Smoke crashed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
