// Tier I commit 2 — QA fixture seeder. The demo seed's Interior section
// spaces tables at 2-cell intervals, so no Manhattan-1 adjacencies exist
// out of the box. This script creates a separate "[Tier I QA]" section
// at La Mama with a 3x3 grid of contiguous tables so Cowork can drive
// the drag-merge UX in Chrome.
//
// Run:  cd server && node scripts/seed-tieri-qa-fixture.js
// Re-running is idempotent — wipes any prior "[Tier I QA]" rows first.
// Cleanup: delete the section from the admin tool (Tier F2 §7.2 — has
// the section-has-reservations 409 guard, so cancel any QA reservations
// first).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SECTION_TAG = '[Tier I QA]';
// Contiguous 3x3 + an extra cell at (3,0) so the 4-table cap can be
// tested by attempting a 5-table merge (T-I1+T-I2+T-I3+T-I4+T-I5).
const TABLE_CONFIG = [
  { number: 'TI-1', seats: 2, row: 0, col: 0 },
  { number: 'TI-2', seats: 2, row: 0, col: 1 },
  { number: 'TI-3', seats: 4, row: 0, col: 2 },
  { number: 'TI-4', seats: 2, row: 1, col: 0 },
  { number: 'TI-5', seats: 4, row: 1, col: 1 },
  { number: 'TI-6', seats: 2, row: 1, col: 2 },
  { number: 'TI-7', seats: 6, row: 2, col: 0 },
  { number: 'TI-8', seats: 2, row: 2, col: 1 },
  { number: 'TI-9', seats: 4, row: 2, col: 2 },
];

async function main() {
  const restaurant = await prisma.restaurant.findFirst({
    where: { staff: { some: { username: 'lamama' } } },
  });
  if (!restaurant) {
    console.error('La Mama restaurant not found. Re-run the demo seed first.');
    process.exit(1);
  }

  // Wipe any prior fixture so re-running is idempotent.
  const old = await prisma.tableSection.findMany({
    where: { restaurantId: restaurant.id, nameEn: SECTION_TAG },
    include: { tables: { select: { id: true } } },
  });
  for (const s of old) {
    const tids = s.tables.map((t) => t.id);
    if (tids.length) {
      // Cancel any future reservations attached so the section delete
      // below doesn't bomb on the Tier F2 section-has-reservations guard.
      await prisma.reservation.deleteMany({ where: { tableId: { in: tids } } });
      await prisma.tableMove.deleteMany({ where: { tableId: { in: tids } } });
    }
    await prisma.tableSection.delete({ where: { id: s.id } });
  }

  const section = await prisma.tableSection.create({
    data: {
      restaurantId: restaurant.id,
      nameRo: SECTION_TAG,
      nameEn: SECTION_TAG,
      gridRows: 3,
      gridColumns: 3,
      displayOrder: 99,
    },
  });
  console.log(`Created section ${section.id} (${SECTION_TAG})`);

  for (const t of TABLE_CONFIG) {
    await prisma.restaurantTable.create({
      data: {
        sectionId: section.id,
        restaurantId: restaurant.id,
        tableNumber: t.number,
        seatCount: t.seats,
        gridRow: t.row,
        gridCol: t.col,
      },
    });
  }
  console.log(`Created ${TABLE_CONFIG.length} contiguous tables (TI-1 through TI-${TABLE_CONFIG.length}).`);
  console.log('');
  console.log('Cowork QA path:');
  console.log('  1) Open http://localhost:3001/dashboard/live, log in as lamama/lamama123.');
  console.log('  2) Switch to the "[Tier I QA]" section tab.');
  console.log('  3) Drag the ⠿ handle on TI-1 onto TI-2 → merge card "TI-1+TI-2" appears spanning 2 cells.');
  console.log('  4) Drag the merge handle onto TI-3 (or drag TI-3 onto the merge) → "TI-1+TI-2+TI-3".');
  console.log('  5) Try a 5th merge → toast says "max 4 tables".');
  console.log('  6) Click the merged card → popup opens with the combined label header + Unmerge action.');
  console.log('  7) Click Unmerge → toast confirms; cells revert to standalone TI-x cards.');
  console.log('  8) Test override flow: create a reservation for party of 10 via Quick Add, then go to');
  console.log('     /dashboard/live?confirmReservationId=<id> and click a TI-x with 2 seats → OverrideModal opens.');
  console.log('  9) Try drag-to-non-adjacent (TI-1 → TI-9) → cursor shows not-allowed, no merge created.');
  console.log('');
  console.log('Cleanup when done: admin tool /dashboard/restaurants/<id>/layout-editor → Delete section');
  console.log('(Tier F2 section-has-reservations guard will refuse if reservations are still attached).');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
