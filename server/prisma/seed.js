// Database Seed Script
// Creates initial admin user and a demo restaurant for testing

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ============================================
  // 1. Create Admin User
  // ============================================
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.adminUser.upsert({
    where: { email: 'admin@aprez.ro' },
    update: {},
    create: {
      email: 'admin@aprez.ro',
      passwordHash: adminPassword,
      name: 'Victor Sebastian Stroe',
    },
  });
  console.log(`Admin user created: ${admin.email} (password: admin123)`);

  // ============================================
  // 2. Create Demo Restaurant
  // ============================================
  const restaurant = await prisma.restaurant.upsert({
    where: { id: 'demo-restaurant-001' },
    update: {},
    create: {
      id: 'demo-restaurant-001',
      nameRo: 'La Mama',
      nameEn: 'La Mama',
      descriptionRo: 'Restaurant tradițional românesc cu preparate autentice din bucătăria locală.',
      descriptionEn: 'Traditional Romanian restaurant with authentic local cuisine.',
      cuisineTypes: ['Romanian', 'Traditional'],
      address: 'Strada Barbu Văcărescu 3, București 020281',
      latitude: 44.4396,
      longitude: 26.0963,
      phone: '+40721234567',
      email: 'contact@lamama.ro',
      website: 'https://lamama.ro',
      maxPartySize: 30,
      reservationDurationMin: 120,
      autoConfirmEnabled: true,
      autoConfirmMaxParty: 4,
      autoConfirmLeadHours: 24,
      isActive: true,
    },
  });
  console.log(`Restaurant created: ${restaurant.nameEn}`);

  // ============================================
  // 3. Opening Hours (Mon-Sun)
  // ============================================
  const days = [
    { day: 0, open: true, openTime: '10:00', closeTime: '23:00' },  // Monday
    { day: 1, open: true, openTime: '10:00', closeTime: '23:00' },  // Tuesday
    { day: 2, open: true, openTime: '10:00', closeTime: '23:00' },  // Wednesday
    { day: 3, open: true, openTime: '10:00', closeTime: '23:00' },  // Thursday
    { day: 4, open: true, openTime: '10:00', closeTime: '00:00' },  // Friday
    { day: 5, open: true, openTime: '10:00', closeTime: '00:00' },  // Saturday
    { day: 6, open: true, openTime: '11:00', closeTime: '22:00' },  // Sunday
  ];

  for (const d of days) {
    await prisma.openingHours.upsert({
      where: {
        restaurantId_dayOfWeek: { restaurantId: restaurant.id, dayOfWeek: d.day },
      },
      update: {},
      create: {
        restaurantId: restaurant.id,
        dayOfWeek: d.day,
        isOpen: d.open,
        openTime: d.openTime,
        closeTime: d.closeTime,
      },
    });
  }
  console.log('Opening hours created');

  // ============================================
  // 4. Service Periods
  // ============================================
  await prisma.servicePeriod.createMany({
    data: [
      {
        restaurantId: restaurant.id,
        nameRo: 'Prânz',
        nameEn: 'Lunch',
        startTime: '10:00',
        endTime: '15:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      {
        restaurantId: restaurant.id,
        nameRo: 'Cină',
        nameEn: 'Dinner',
        startTime: '15:00',
        endTime: '23:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      {
        restaurantId: restaurant.id,
        nameRo: 'Brunch de Weekend',
        nameEn: 'Weekend Brunch',
        startTime: '09:00',
        endTime: '13:00',
        daysOfWeek: [5, 6],
      },
    ],
    skipDuplicates: true,
  });
  console.log('Service periods created');

  // ============================================
  // 5. Table Section + Tables
  // ============================================
  let section = await prisma.tableSection.findFirst({
    where: { restaurantId: restaurant.id, nameEn: 'Interior' },
  });

  if (!section) {
    section = await prisma.tableSection.create({
      data: {
        restaurantId: restaurant.id,
        nameRo: 'Interior',
        nameEn: 'Interior',
        gridRows: 5,
        gridColumns: 6,
        displayOrder: 1,
      },
    });
  }

  // Create 10 tables in a grid layout
  const tableConfigs = [
    { number: 'T1', seats: 2, row: 0, col: 0 },
    { number: 'T2', seats: 2, row: 0, col: 2 },
    { number: 'T3', seats: 4, row: 0, col: 4 },
    { number: 'T4', seats: 4, row: 1, col: 1 },
    { number: 'T5', seats: 6, row: 1, col: 3 },
    { number: 'T6', seats: 2, row: 2, col: 0 },
    { number: 'T7', seats: 4, row: 2, col: 2 },
    { number: 'T8', seats: 8, row: 3, col: 1 },
    { number: 'T9', seats: 2, row: 3, col: 4 },
    { number: 'T10', seats: 4, row: 4, col: 2 },
  ];

  for (const t of tableConfigs) {
    const existing = await prisma.restaurantTable.findUnique({
      where: { sectionId_gridRow_gridCol: { sectionId: section.id, gridRow: t.row, gridCol: t.col } },
    });
    if (!existing) {
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
  }
  console.log('Tables created (10 tables in Interior section)');

  // Create Terrace section
  let terrace = await prisma.tableSection.findFirst({
    where: { restaurantId: restaurant.id, nameEn: 'Terrace' },
  });

  if (!terrace) {
    terrace = await prisma.tableSection.create({
      data: {
        restaurantId: restaurant.id,
        nameRo: 'Terasă',
        nameEn: 'Terrace',
        gridRows: 3,
        gridColumns: 4,
        displayOrder: 2,
      },
    });
  }

  const terraceTableConfigs = [
    { number: 'T11', seats: 2, row: 0, col: 0 },
    { number: 'T12', seats: 4, row: 0, col: 2 },
    { number: 'T13', seats: 2, row: 1, col: 1 },
    { number: 'T14', seats: 6, row: 1, col: 3 },
    { number: 'T15', seats: 4, row: 2, col: 0 },
  ];

  for (const t of terraceTableConfigs) {
    const existing = await prisma.restaurantTable.findUnique({
      where: { sectionId_gridRow_gridCol: { sectionId: terrace.id, gridRow: t.row, gridCol: t.col } },
    });
    if (!existing) {
      await prisma.restaurantTable.create({
        data: {
          sectionId: terrace.id,
          restaurantId: restaurant.id,
          tableNumber: t.number,
          seatCount: t.seats,
          gridRow: t.row,
          gridCol: t.col,
        },
      });
    }
  }
  console.log('Terrace tables created (5 tables)');

  // ============================================
  // 6. Restaurant Staff Login
  // ============================================
  const staffPassword = await bcrypt.hash('lamama123', 12);
  await prisma.restaurantStaff.upsert({
    where: { username: 'lamama' },
    update: {},
    create: {
      restaurantId: restaurant.id,
      username: 'lamama',
      passwordHash: staffPassword,
      displayName: 'La Mama Staff',
    },
  });
  console.log('Restaurant staff created: username=lamama, password=lamama123');

  // ============================================
  // 7. Demo User
  // ============================================
  const userPassword = await bcrypt.hash('user123', 12);
  await prisma.user.upsert({
    where: { phone: '+40751234567' },
    update: {},
    create: {
      phone: '+40751234567',
      email: 'demo@aprez.ro',
      firstName: 'Ion',
      lastName: 'Popescu',
      passwordHash: userPassword,
      phoneVerified: true,
      preferredLanguage: 'ro',
      latitude: 44.4268,
      longitude: 26.1025,
    },
  });
  console.log('Demo user created: phone=+40751234567, email=demo@aprez.ro, password=user123');

  console.log('\n✅ Database seeded successfully!');
  console.log('\nLogin credentials:');
  console.log('  Admin:      admin@aprez.ro / admin123');
  console.log('  Restaurant: lamama / lamama123');
  console.log('  User:       +40751234567 or demo@aprez.ro / user123');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
