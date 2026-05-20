// Tier J launch QA — reset demo@aprez.ro's expoPushToken to NULL.
// Used to wipe out a stale or injected test value so the next mobile
// `registerPushToken()` call gets a clean fresh round-trip.
//
// Usage (from server/):  node scripts/reset-push-token.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.user.update({
  where: { email: 'demo@aprez.ro' },
  data: { expoPushToken: null },
})
  .then((u) => {
    console.log('[reset] expoPushToken cleared for', u.email);
  })
  .catch((e) => {
    console.error('[reset] failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
