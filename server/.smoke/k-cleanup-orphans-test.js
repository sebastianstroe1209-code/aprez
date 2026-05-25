// Tier K cleanup — hard-delete of the orphan audit user.
//
// The pre-Tier-K audit input-fuzzed /auth/register and left a row with
// email "weird'quote@example.com" (id 03ba3d5a-5801-4036-98dd-b4e9cccdab62)
// in the live users table. scripts/cleanup-tier-k-orphans.js removed it.
// This smoke asserts the row stays gone — so a future audit pass that
// happens to recreate it will surface the regression immediately.
//
//   [a] no row exists with the audit id.
//   [b] no row exists with the audit email.
//   [c] script is idempotent — running it again on a clean DB exits 0
//       and reports [ok].
//
// Requires the live Railway DB connection in server/.env.

const path = require('path');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORPHAN_ID = '03ba3d5a-5801-4036-98dd-b4e9cccdab62';
const ORPHAN_EMAIL = "weird'quote@example.com";
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'cleanup-tier-k-orphans.js');

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function main() {
  console.log('[a] no row exists with the audit id');
  const byId = await prisma.$queryRawUnsafe(
    `SELECT id FROM users WHERE id = $1`,
    ORPHAN_ID
  );
  expect(byId.length === 0, `users WHERE id=${ORPHAN_ID} returns 0 rows (got ${byId.length})`);

  console.log('\n[b] no row exists with the audit email');
  const byEmail = await prisma.$queryRawUnsafe(
    `SELECT id FROM users WHERE email = $1`,
    ORPHAN_EMAIL
  );
  expect(byEmail.length === 0, `users WHERE email=${ORPHAN_EMAIL} returns 0 rows (got ${byEmail.length})`);

  console.log('\n[c] cleanup-tier-k-orphans.js is idempotent on a clean DB');
  let out;
  try {
    out = execFileSync('node', [SCRIPT], { encoding: 'utf8' });
  } catch (err) {
    failed++;
    console.error(`  FAIL — script crashed: ${err.message}`);
    out = err.stdout || '';
  }
  expect(/\[ok\] no row with id=/.test(out), `script reports [ok] no row with id (got: ${out.split('\n').filter(Boolean).slice(0, 3).join(' | ')})`);

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed === 0) console.log('SMOKE OK');
  else console.log('SMOKE FAILED');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Smoke crashed:', err);
  process.exitCode = 1;
  await prisma.$disconnect();
});
