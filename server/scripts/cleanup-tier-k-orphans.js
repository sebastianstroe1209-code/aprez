// One-off cleanup — hard-delete the orphan user created by the Tier K
// pre-audit probe (subagent's input-fuzz pass against /auth/register).
//
//   email: weird'quote@example.com
//   id:    03ba3d5a-5801-4036-98dd-b4e9cccdab62
//
// The audit confirmed no reservations are attached. Cascade rules on
// the User relations (favorites / bans / notifications) handle the rest.
// Soft-delete (`deletedAt`) is reserved for live diner GDPR — an audit
// artifact should not persist as a soft-deleted row, so we hard-delete.
//
// Idempotent — if the row is already gone, prints [ok] and exits 0.
//
// Usage (from server/):  node scripts/cleanup-tier-k-orphans.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORPHAN_ID = '03ba3d5a-5801-4036-98dd-b4e9cccdab62';
const ORPHAN_EMAIL = "weird'quote@example.com";

async function main() {
  console.log('--- tier-K orphan user cleanup ---');

  const before = await prisma.$queryRawUnsafe(
    `SELECT id, email, deleted_at, created_at FROM users WHERE id = $1`,
    ORPHAN_ID
  );
  if (!before.length) {
    console.log(`[ok] no row with id=${ORPHAN_ID} — already cleaned up.`);
    return;
  }
  const row = before[0];
  console.log(`[found] id=${row.id} email=${row.email} created=${row.created_at}`);
  if (row.email !== ORPHAN_EMAIL) {
    console.error(`[abort] email mismatch — expected "${ORPHAN_EMAIL}" got "${row.email}".`);
    console.error('         Not deleting — this id may belong to a different row.');
    process.exit(2);
  }

  // Safety: confirm no reservations are attached.
  const resCount = await prisma.reservation.count({ where: { userId: ORPHAN_ID } });
  if (resCount > 0) {
    console.error(`[abort] ${resCount} reservations attached. Refusing to hard-delete.`);
    process.exit(3);
  }
  console.log('[ok] zero reservations attached.');

  // Hard-delete. Other relations (favorites, bans, notifications) cascade
  // per their FK definitions on User.
  await prisma.user.delete({ where: { id: ORPHAN_ID } });
  console.log('[fix] orphan user hard-deleted.');

  const after = await prisma.$queryRawUnsafe(
    `SELECT id FROM users WHERE id = $1`,
    ORPHAN_ID
  );
  console.log(`[verify] post-delete row count: ${after.length}`);

  console.log('[done] cleanup complete.');
}

main()
  .catch((e) => {
    console.error('!!! cleanup failed:');
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
