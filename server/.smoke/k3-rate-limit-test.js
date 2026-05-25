// Tier K3 — auth rate limiting.
//
// Pre-K3: /auth/login took an unbounded number of failed-password
// attempts (12 in a row = 12× 401, never 429); forgot-password let an
// IP spam any number of accounts. K3 wires express-rate-limit:
//   login: 5 / 15 min per (IP, lowercased email/username)
//   forgot-password: 3 / hour per email + 10 / hour per IP
//
//   [a] 5 bad logins for one (IP, random email) → 6th returns 429,
//       structured body + Retry-After header.
//   [b] Successful login is NOT counted (skipSuccessfulRequests=true).
//   [c] 3 forgot-password POSTs for one email → 4th returns 429.
//   [d] 10 forgot-password POSTs from one IP across different emails
//       → 11th returns 429 (per-IP guard, even when no single email
//       has been hit 3 times yet).
//
// Resets the in-memory limiter store at startup via the dev-only
// /api/__test/reset-rate-limits endpoint so the smoke is deterministic.
// Requires the backend on :4000.

const BASE = 'http://localhost:4000/api';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

const rand = () => Math.random().toString(36).slice(2, 10);

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j, retryAfter: r.headers.get('retry-after') };
}

async function main() {
  console.log('[reset] wipe limiter store via dev-only endpoint');
  const reset = await post('/__test/reset-rate-limits', {});
  expect(reset.status === 200, `reset returned 200 (got ${reset.status})`);

  console.log('\n[a] 5 bad logins → 6th = 429 with structured body + Retry-After');
  const bruteEmail = `k3-brute-${rand()}@example.com`;
  for (let i = 1; i <= 5; i++) {
    const r = await post('/auth/login', { email: bruteEmail, password: 'wrong' });
    expect(r.status === 401, `attempt ${i} status 401 (got ${r.status})`);
  }
  const sixth = await post('/auth/login', { email: bruteEmail, password: 'wrong' });
  expect(sixth.status === 429, `6th attempt status 429 (got ${sixth.status})`);
  expect(sixth.body?.error?.code === 'rate-limited',
    `429 body has error.code='rate-limited' (got ${JSON.stringify(sixth.body)?.slice(0, 100)})`);
  expect(typeof sixth.body?.error?.retryAfterSec === 'number' && sixth.body.error.retryAfterSec > 0,
    `429 body has retryAfterSec > 0 (got ${sixth.body?.error?.retryAfterSec})`);
  expect(!!sixth.retryAfter && Number(sixth.retryAfter) > 0,
    `Retry-After header present (got "${sixth.retryAfter}")`);

  console.log('\n[b] successful login does NOT count toward the limit');
  await post('/__test/reset-rate-limits', {});
  // 4 failed logins for demo (counter = 4 of 5)
  for (let i = 1; i <= 4; i++) {
    const r = await post('/auth/login', { email: 'demo@aprez.ro', password: 'wrong' });
    expect(r.status === 401, `setup fail ${i} → 401 (got ${r.status})`);
  }
  // A successful login — should NOT bump the counter.
  const ok = await post('/auth/login', { email: 'demo@aprez.ro', password: 'user123' });
  expect(ok.status === 200, `successful login → 200 (got ${ok.status})`);
  // After success, the (IP, demo@aprez.ro) bucket should still be at 4. One
  // more failed attempt = 5 (still allowed). The 6th call total is the one
  // that should be 429, NOT this 5th.
  const fifthFail = await post('/auth/login', { email: 'demo@aprez.ro', password: 'wrong' });
  expect(fifthFail.status === 401, `fifth-fail-after-success → 401 not 429 (got ${fifthFail.status})`);
  const sixthFail = await post('/auth/login', { email: 'demo@aprez.ro', password: 'wrong' });
  expect(sixthFail.status === 429, `sixth-fail → 429 (got ${sixthFail.status})`);

  console.log('\n[c] 3 forgot-password POSTs for one email → 4th = 429');
  await post('/__test/reset-rate-limits', {});
  const fpEmail = `k3-fp-${rand()}@example.com`;
  for (let i = 1; i <= 3; i++) {
    const r = await post('/auth/diner/forgot-password', { email: fpEmail });
    expect(r.status === 200, `fp ${i} → 200 (got ${r.status})`);
  }
  const fp4 = await post('/auth/diner/forgot-password', { email: fpEmail });
  expect(fp4.status === 429, `4th fp → 429 (got ${fp4.status})`);

  console.log('\n[d] 10 forgot-password POSTs from one IP across emails → 11th = 429');
  await post('/__test/reset-rate-limits', {});
  for (let i = 1; i <= 10; i++) {
    const r = await post('/auth/diner/forgot-password', { email: `k3-ip-${i}-${rand()}@example.com` });
    expect(r.status === 200, `ip-sweep ${i} → 200 (got ${r.status})`);
  }
  const ip11 = await post('/auth/diner/forgot-password', { email: `k3-ip-11-${rand()}@example.com` });
  expect(ip11.status === 429, `11th cross-email fp → 429 (got ${ip11.status})`);

  console.log('\n[cleanup] reset limiter store so the next smoke run starts clean');
  await post('/__test/reset-rate-limits', {});

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
