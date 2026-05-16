// Tier I commit 2 fix-the-fix — one-off cleanup of Cowork's QA debris.
// Routes the reservation cancel through the real staff endpoint (so the
// dispatcher event fires + audit log is preserved), then routes the
// section delete through the real F2 admin endpoint (so its
// section-has-reservations guard runs against actual current state).
//
// Run once:  cd server && node scripts/cleanup-tieri-qa.js
// Safe to re-run — already-cancelled / already-deleted are reported as
// no-ops rather than errors.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Updated 2026-05-17 for the second QA cycle (fix-the-fix #2 debris).
// Override QA2 reservation + new [Tier I QA] section UUID.
const RESV_ID = 'ddef5ce5-e58e-4126-916d-0894a1d9bb93';
const SECTION_ID = '02b4a90f-6536-4342-a27c-f8a0e7cb3f87';
const BASE = 'http://localhost:4000/api';

async function staffToken() {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lamama', password: 'lamama123' }),
  });
  const d = await r.json();
  return d.token;
}
async function adminToken() {
  const r = await fetch(`${BASE}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aprez.ro', password: 'admin123' }),
  });
  const d = await r.json();
  return d.token;
}

async function main() {
  const tStaff = await staffToken();
  const tAdmin = await adminToken();

  // Inspect first.
  const resvBefore = await prisma.reservation.findUnique({ where: { id: RESV_ID } });
  console.log(`Reservation ${RESV_ID}:`);
  if (!resvBefore) {
    console.log('  (already gone)');
  } else {
    console.log(`  status=${resvBefore.status} party=${resvBefore.partySize} tableId=${resvBefore.tableId} date=${resvBefore.date.toISOString().slice(0,10)} time=${resvBefore.time}`);
  }

  const sectionBefore = await prisma.tableSection.findUnique({
    where: { id: SECTION_ID },
    include: { tables: { select: { id: true } } },
  });
  console.log(`Section ${SECTION_ID}:`);
  if (!sectionBefore) {
    console.log('  (already gone)');
  } else {
    console.log(`  nameEn=${sectionBefore.nameEn} tables=${sectionBefore.tables.length}`);
  }

  // Step 1: cancel the reservation via the staff endpoint. Skip if
  // already CANCELLED — the endpoint would 400.
  if (resvBefore && resvBefore.status !== 'CANCELLED') {
    console.log('\nCancelling reservation via PUT /restaurant/reservations/:id/cancel ...');
    const r = await fetch(`${BASE}/restaurant/reservations/${RESV_ID}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tStaff}` },
    });
    const d = await r.json().catch(() => ({}));
    console.log(`  HTTP ${r.status}  status=${d.status}  cancelledBy=${d.cancelledBy}`);
  }

  // Step 2: delete the section via the F2 admin endpoint.
  //
  // KNOWN ISSUE (documented in schema.prisma TableMove model comment):
  // the F2 endpoint cascade-deletes section → tables, but RestaurantTable
  // is FK'd from TableMove with default RESTRICT, so the cascade FK-fails
  // when QA tables have TableMove history. Workaround: hand-delete the
  // TableMove rows for this section's tables first, then call the F2
  // endpoint cleanly. Schema fix (onDelete: Cascade on TableMove.table)
  // is deferred to Tier J — wasn't authorized in this turn.
  if (sectionBefore) {
    const tableIds = sectionBefore.tables.map((t) => t.id);
    if (tableIds.length) {
      const removedMoves = await prisma.tableMove.deleteMany({
        where: { tableId: { in: tableIds } },
      });
      console.log(`\nPre-cleanup: removed ${removedMoves.count} TableMove rows for section's tables`);
    }

    console.log('Deleting section via DELETE /admin/sections/:id ...');
    const r = await fetch(`${BASE}/admin/sections/${SECTION_ID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tAdmin}` },
    });
    const d = await r.json().catch(() => ({}));
    console.log(`  HTTP ${r.status}  ${JSON.stringify(d)}`);
  }

  // Verify gone.
  const resvAfter = await prisma.reservation.findUnique({ where: { id: RESV_ID } });
  const sectionAfter = await prisma.tableSection.findUnique({ where: { id: SECTION_ID } });
  console.log('');
  console.log(`Reservation after: ${resvAfter ? `EXISTS status=${resvAfter.status}` : 'GONE'}`);
  console.log(`Section after:    ${sectionAfter ? 'EXISTS' : 'GONE'}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('CLEANUP THREW:', e);
  await prisma.$disconnect();
  process.exit(1);
});
