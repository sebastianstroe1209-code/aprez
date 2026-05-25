// Tier K2 — security headers + framework-disclosure leak.
//
// Pre-K2 the live Render service returned ZERO security headers and
// leaked "X-Powered-By: Express". K2 wires `helmet` (with CSP disabled
// for now — see comment in index.js) plus `app.disable('x-powered-by')`.
//
//   [a] X-Powered-By header is absent.
//   [b] X-Content-Type-Options is "nosniff".
//   [c] X-Frame-Options is set (SAMEORIGIN or DENY).
//   [d] Referrer-Policy is set.
//   [e] Strict-Transport-Security is set (helmet default).
//   [f] Content-Security-Policy is ABSENT (we explicitly disabled it
//       so future audits know the gap is intentional).
//
// Requires the backend on :4000.

const BASE = 'http://localhost:4000/api';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function main() {
  const r = await fetch(`${BASE}/health`);
  const h = r.headers;
  // fetch normalizes header names lowercase via .get(); use as-is.

  console.log('[a] X-Powered-By header is absent');
  expect(h.get('x-powered-by') === null, `x-powered-by null (got ${JSON.stringify(h.get('x-powered-by'))})`);

  console.log('\n[b] X-Content-Type-Options is "nosniff"');
  expect(h.get('x-content-type-options') === 'nosniff',
    `x-content-type-options === 'nosniff' (got ${JSON.stringify(h.get('x-content-type-options'))})`);

  console.log('\n[c] X-Frame-Options is set');
  const xfo = h.get('x-frame-options');
  expect(xfo === 'SAMEORIGIN' || xfo === 'DENY', `x-frame-options is SAMEORIGIN or DENY (got ${JSON.stringify(xfo)})`);

  console.log('\n[d] Referrer-Policy is set');
  expect(typeof h.get('referrer-policy') === 'string' && h.get('referrer-policy').length > 0,
    `referrer-policy is non-empty (got ${JSON.stringify(h.get('referrer-policy'))})`);

  console.log('\n[e] Strict-Transport-Security is set');
  const hsts = h.get('strict-transport-security');
  expect(typeof hsts === 'string' && /max-age=\d+/.test(hsts),
    `HSTS has max-age=… (got ${JSON.stringify(hsts)})`);

  console.log('\n[f] Content-Security-Policy is ABSENT (intentionally disabled — see index.js)');
  expect(h.get('content-security-policy') === null,
    `content-security-policy null (got ${JSON.stringify(h.get('content-security-policy'))})`);

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
