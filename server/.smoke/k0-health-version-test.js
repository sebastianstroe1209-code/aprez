// Tier K0 — /api/health deploy diagnostic.
//
// Auto-deploy on Render had no proven heartbeat: Sebastian QA'd Build 8
// and saw the OLD reminder copy live, even though commit 6e2a428 fixed
// it. We had no way to tell whether Render had pulled the commit.
//
// K0 extends /api/health to include `commit` (RENDER_GIT_COMMIT short
// SHA, injected on Render at build time; 'local' off-Render) and `env`
// (NODE_ENV). Curling https://aprez-server.onrender.com/api/health now
// reports which SHA is serving.
//
//   [a] GET /api/health → 200 with { status, timestamp, commit, env }.
//   [b] `status` is the string 'ok'.
//   [c] `commit` is a string (locally 'local', on Render a 7-char SHA).
//   [d] `env` is a non-empty string.
//   [e] `timestamp` is a parseable ISO date close to now.
//
// Requires the backend on :4000.

const BASE = 'http://localhost:4000/api';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function main() {
  console.log('[a] GET /health → 200 with new shape');
  const r = await fetch(`${BASE}/health`);
  expect(r.status === 200, `status 200 (got ${r.status})`);
  const body = await r.json();
  expect(body && typeof body === 'object', 'body is an object');
  expect('status' in body && 'timestamp' in body && 'commit' in body && 'env' in body,
    `body has {status,timestamp,commit,env} (got keys: ${Object.keys(body).join(',')})`);

  console.log('\n[b] status is the literal "ok"');
  expect(body.status === 'ok', `status === 'ok' (got ${body.status})`);

  console.log('\n[c] commit is a string');
  expect(typeof body.commit === 'string' && body.commit.length > 0,
    `commit is non-empty string (got "${body.commit}")`);
  // Off-Render: 'local'. On Render: 7-char hex.
  expect(body.commit === 'local' || /^[0-9a-f]{7}$/.test(body.commit),
    `commit is 'local' or 7-char hex (got "${body.commit}")`);

  console.log('\n[d] env is a non-empty string');
  expect(typeof body.env === 'string' && body.env.length > 0,
    `env is non-empty (got "${body.env}")`);

  console.log('\n[e] timestamp is a recent ISO date');
  const ts = new Date(body.timestamp);
  expect(!isNaN(ts.getTime()), `timestamp parseable (got "${body.timestamp}")`);
  const driftMs = Math.abs(Date.now() - ts.getTime());
  expect(driftMs < 30000, `timestamp within 30s of now (drift=${driftMs}ms)`);

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
