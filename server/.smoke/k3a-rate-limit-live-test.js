// Tier K3a — LIVE-target rate-limit smoke.
//
// The original K3 smoke hits http://localhost:4000, which bypasses
// Cloudflare and Render's LB — and therefore bypasses the
// trust-proxy / X-Forwarded-For / CF-Connecting-IP code paths that
// determine the rate-limit bucket key in production. Sebastian's live
// verification found 7 wrong-password POSTs all returned 401 because
// the limiter was keying on the upstream Cloudflare edge IP, which
// VARIES per CF POP routing — every request landed in a different
// bucket, none accumulated. K3a swapped the keyGenerator to prefer
// the `cf-connecting-ip` header (CF-guaranteed, can't be spoofed when
// CF is upstream) + bumped `trust proxy` to 2 (CF + Render LB chain).
//
// This smoke hits the LIVE Render URL directly so the regression
// class can't slip through again. Use a synthetic email per run so
// the per-bucket lockout (15 min) doesn't collide with anything real.
//
//   [a] First request returns 401 (creds wrong, limiter not yet tripped)
//       with a sane RateLimit-Remaining header.
//   [b] RateLimit-Remaining decreases monotonically across requests —
//       proves the keyGenerator is producing a STABLE key (pre-K3a it
//       bounced because CF edge IP varied per request).
//   [c] At least one 429 lands in 8 sequential requests with the same
//       (synthetic email, bad password). Pre-K3a we saw 7 attempts
//       with zero 429s.
//   [d] The 429 response has the structured shape K3 promised:
//       { error: { code: 'rate-limited', retryAfterSec } } +
//       Retry-After header.
//
// NOT included in the default battery — this hits production and
// leaves a 15-min lockout bucket behind per run. Use as a manual
// verification smoke after any K3/K3a-class change.
//
// Usage:  node server/.smoke/k3a-rate-limit-live-test.js

const LIVE = 'https://aprez-server.onrender.com/api';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function post(path, body) {
  const r = await fetch(`${LIVE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return {
    status: r.status,
    body: j,
    rateLimit: r.headers.get('ratelimit'),
    rateLimitRemaining: r.headers.get('ratelimit-remaining'),
    retryAfter: r.headers.get('retry-after'),
  };
}

function parseRemaining(rl) {
  // express-rate-limit draft-7 header: 'limit=5, remaining=4, reset=900'
  const m = rl && rl.match(/remaining=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function main() {
  console.log('--- K3a live rate-limit smoke ---');
  console.log(`Target: ${LIVE}`);

  const synth = `k3a-livesmoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  console.log(`Synthetic email: ${synth}`);

  const results = [];
  for (let i = 1; i <= 8; i++) {
    const r = await post('/auth/login', { email: synth, password: 'wrong' });
    const remaining = parseRemaining(r.rateLimit);
    console.log(`  i=${i} status=${r.status}  ratelimit="${r.rateLimit}"  remaining=${remaining}`);
    results.push({ ...r, remaining, i });
  }

  console.log('\n[a] First request is 401 with a sane RateLimit-Remaining');
  expect(results[0].status === 401, `request 1 → 401 (got ${results[0].status})`);
  expect(typeof results[0].remaining === 'number' && results[0].remaining >= 0,
    `request 1 RateLimit-Remaining is a number ≥ 0 (got ${results[0].remaining})`);

  console.log('\n[b] RateLimit-Remaining decreases monotonically (proves key stability)');
  // Once the bucket hits 0 it stays at 0; treat ≤ previous as monotonic.
  let monotonic = true;
  let bounceAt = null;
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1].remaining;
    const cur = results[i].remaining;
    if (cur === null || prev === null) continue;
    // After a 429, remaining can momentarily appear larger if the
    // implementation clamps to 0 only on the next request. Allow that.
    if (results[i - 1].status === 429) continue;
    if (cur > prev) { monotonic = false; bounceAt = i; break; }
  }
  expect(monotonic,
    `remaining never increases across consecutive 401s (bounce at i=${bounceAt}: ${JSON.stringify(results.map((r) => r.remaining))})`);

  console.log('\n[c] At least one 429 in 8 attempts');
  const four29s = results.filter((r) => r.status === 429);
  expect(four29s.length >= 1, `≥1 attempt returned 429 (got ${four29s.length}; codes=${results.map((r) => r.status).join(',')})`);

  console.log('\n[d] The 429 response has the structured shape + Retry-After');
  if (four29s.length > 0) {
    const t = four29s[0];
    expect(t.body?.error?.code === 'rate-limited',
      `429 error.code='rate-limited' (got ${JSON.stringify(t.body)?.slice(0, 120)})`);
    expect(typeof t.body?.error?.retryAfterSec === 'number' && t.body.error.retryAfterSec > 0,
      `429 retryAfterSec is a positive number (got ${t.body?.error?.retryAfterSec})`);
    expect(!!t.retryAfter && Number(t.retryAfter) > 0,
      `429 Retry-After header present (got "${t.retryAfter}")`);
  } else {
    failed++;
    console.error('  FAIL — no 429 to inspect (covered above)');
  }

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
