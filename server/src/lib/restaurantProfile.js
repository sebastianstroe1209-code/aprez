// Shared restaurant opening-hours + service-period write logic.
//
// Both the admin restaurant-edit endpoint (PUT /api/admin/restaurants/:id)
// and the staff self-service endpoint (PUT /api/restaurant/settings)
// accept the same array shapes and persist them with the same delete +
// recreate strategy. Factored here so the two callers can't drift.
//
// openingHours item shape: { day: 'Monday'..'Sunday', isOpen, openTime, closeTime }
// servicePeriods item shape: { nameRo, nameEn, startTime, endTime, daysOfWeek: number[] }

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Replace the restaurant's opening hours with the supplied array. A
// non-array argument (undefined / omitted) is a no-op so callers can
// pass req.body.openingHours unconditionally.
async function applyOpeningHours(prisma, restaurantId, openingHours) {
  if (!Array.isArray(openingHours)) return;
  await prisma.openingHours.deleteMany({ where: { restaurantId } });
  for (const oh of openingHours) {
    const dayIndex = DAYS.indexOf(oh.day);
    if (dayIndex === -1) continue;
    await prisma.openingHours.create({
      data: {
        restaurantId,
        dayOfWeek: dayIndex,
        isOpen: oh.isOpen !== false,
        openTime: oh.openTime || '09:00',
        closeTime: oh.closeTime || '23:00',
      },
    });
  }
}

// Replace the restaurant's service periods with the supplied array.
// Non-array argument is a no-op.
async function applyServicePeriods(prisma, restaurantId, servicePeriods) {
  if (!Array.isArray(servicePeriods)) return;
  await prisma.servicePeriod.deleteMany({ where: { restaurantId } });
  for (const sp of servicePeriods) {
    if (!sp.nameRo && !sp.nameEn) continue;
    await prisma.servicePeriod.create({
      data: {
        restaurantId,
        nameRo: sp.nameRo || sp.nameEn,
        nameEn: sp.nameEn || sp.nameRo,
        startTime: sp.startTime || '12:00',
        endTime: sp.endTime || '15:00',
        daysOfWeek: Array.isArray(sp.daysOfWeek) ? sp.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
      },
    });
  }
}

module.exports = { applyOpeningHours, applyServicePeriods };
