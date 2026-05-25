// Tier K1 — Prisma schema leak through /auth/login 500.
//
// Pre-K1: POST /auth/login with empty body or `email: undefined`
// returned HTTP 500 with the full UserWhereInput schema (column
// names: passwordHash, expoPushToken, deletedAt, phonePromptSeenAt,
// AND / OR / NOT). The validators were declared but never checked —
// the request fell through to prisma.user.findUnique({ where:
// { email: undefined } }) which threw a verbose validation error
// that the bare global-error-handler echoed back unmodified.
//
// Fix: two layers.
//   1. /auth/login handler now calls validationResult(req) and
//      returns a structured 400 before touching Prisma.
//   2. Global error sanitizer: in production, never echo Prisma
//      details or stack traces — return a generic 500 instead.
//
//   [a] Empty body → 400 with a short "Email is required" message,
//       not a 500 with the schema dump.
//   [b] Missing password → 400 with "Password is required".
//   [c] Malformed email → 400 with "Invalid email".
//   [d] Valid shape but wrong creds → 401 (unchanged behaviour).
//   [e] Valid creds → 200.
//   [f] Reponse bodies on the 400s do NOT contain Prisma schema
//       column names (UserWhereInput, passwordHash, expoPushToken).
//
// Requires the backend on :4000. Calls the dev-only rate-limit reset
// so the smoke doesn't trip the K3 brute-force lockout.

const BASE = 'http://localhost:4000/api';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  return { status: r.status, body: j, text };
}

async function main() {
  console.log('[reset] wipe K3 limiter store so this smoke isn\'t throttled');
  await post('/__test/reset-rate-limits', {});

  console.log('\n[a] empty body → 400 with short message');
  const a = await post('/auth/login', {});
  expect(a.status === 400, `status 400 (got ${a.status})`);
  expect(typeof a.body?.error?.message === 'string' && a.body.error.message.length < 80,
    `short error.message present (got "${a.body?.error?.message}")`);

  console.log('\n[b] missing password → 400');
  const b = await post('/auth/login', { email: 'someone@example.com' });
  expect(b.status === 400, `status 400 (got ${b.status})`);
  expect(/password/i.test(b.body?.error?.message || ''),
    `error.message mentions password (got "${b.body?.error?.message}")`);

  console.log('\n[c] malformed email → 400');
  const c = await post('/auth/login', { email: 'not-an-email', password: 'whatever' });
  expect(c.status === 400, `status 400 (got ${c.status})`);
  expect(/email/i.test(c.body?.error?.message || ''),
    `error.message mentions email (got "${c.body?.error?.message}")`);

  console.log('\n[d] wrong creds (valid shape) → 401');
  const d = await post('/auth/login', { email: 'nobody@example.com', password: 'wrong' });
  expect(d.status === 401, `status 401 (got ${d.status})`);

  console.log('\n[e] valid creds → 200');
  const e = await post('/auth/login', { email: 'demo@aprez.ro', password: 'user123' });
  expect(e.status === 200, `status 200 (got ${e.status})`);
  expect(typeof e.body?.token === 'string', `token present (got typeof ${typeof e.body?.token})`);

  console.log('\n[f] no Prisma schema markers in any 400 response body');
  const leakMarkers = ['UserWhereInput', 'passwordHash', 'expoPushToken', 'deletedAt', 'phonePromptSeenAt', 'WhereInput', 'StringFilter'];
  for (const r of [a, b, c]) {
    const blob = r.text || '';
    for (const m of leakMarkers) {
      expect(!blob.includes(m), `400 body does NOT contain Prisma marker "${m}"`);
    }
  }

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
