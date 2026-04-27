const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

// Helper function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Middleware to check validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// GET / - List restaurants with filters
router.get(
  '/',
  authenticateUser,
  [
    query('cuisine').optional().isString(),
    query('search').optional().isString(),
    query('lat').optional().isFloat(),
    query('lng').optional().isFloat(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { cuisine, search, lat, lng } = req.query;

      // Fetch all active restaurants
      let restaurants = await prisma.restaurant.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          nameRo: true,
          nameEn: true,
          descriptionRo: true,
          descriptionEn: true,
          cuisineTypes: true,
          address: true,
          latitude: true,
          longitude: true,
          phone: true,
          email: true,
          coverPhotoUrl: true,
          maxPartySize: true,
        },
      });

      // Check user banned status
      const userBanRecords = await prisma.bannedUser.findMany({
        where: { userId },
        select: { restaurantId: true },
      });
      const bannedRestaurantIds = new Set(userBanRecords.map((r) => r.restaurantId));

      // Filter by cuisine if provided
      if (cuisine) {
        const cuisineFilter = Array.isArray(cuisine) ? cuisine : [cuisine];
        restaurants = restaurants.filter((r) =>
          cuisineFilter.some((c) => r.cuisineTypes.some((ct) => ct.toLowerCase().includes(c.toLowerCase())))
        );
      }

      // Filter by search term
      if (search) {
        const term = search.toLowerCase();
        restaurants = restaurants.filter(
          (r) =>
            (r.nameEn || '').toLowerCase().includes(term) ||
            (r.nameRo || '').toLowerCase().includes(term) ||
            (r.address || '').toLowerCase().includes(term) ||
            (r.cuisineTypes || []).some((c) => c.toLowerCase().includes(term))
        );
      }

      // Add distance and filter banned
      restaurants = restaurants
        .filter((r) => !bannedRestaurantIds.has(r.id))
        .map((r) => {
          const distance =
            lat && lng
              ? calculateDistance(parseFloat(lat), parseFloat(lng), parseFloat(r.latitude), parseFloat(r.longitude))
              : undefined;
          return { ...r, distance };
        });

      // Sort by distance if coordinates provided
      if (lat && lng) {
        restaurants.sort((a, b) => (a.distance || 999) - (b.distance || 999));
      }

      res.json(restaurants);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id - Get full restaurant profile
router.get(
  '/:id',
  authenticateUser,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;

      const restaurant = await prisma.restaurant.findUnique({
        where: { id },
        include: {
          openingHours: {
            orderBy: { dayOfWeek: 'asc' },
          },
          servicePeriods: true,
          photos: {
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Check if user is banned
      const bannedRecord = await prisma.bannedUser.findFirst({
        where: { userId, restaurantId: id },
      });

      if (bannedRecord) {
        return res.status(403).json({ error: 'Not available' });
      }

      res.json(restaurant);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/availability - Check table availability
router.get(
  '/:id/availability',
  authenticateUser,
  [
    param('id').notEmpty().trim(),
    query('date').isISO8601(),
    query('time').matches(/^\d{2}:\d{2}$/),
    query('partySize').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;
      const { date, time, partySize } = req.query;

      // Check if user is banned
      const bannedRecord = await prisma.bannedUser.findFirst({
        where: { userId, restaurantId: id },
      });

      if (bannedRecord) {
        return res.json({ available: false });
      }

      // Find tables that fit the party size
      const tables = await prisma.restaurantTable.findMany({
        where: {
          restaurantId: id,
          isActive: true,
          seatCount: { gte: parseInt(partySize) },
        },
        select: { id: true, seatCount: true },
      });

      if (tables.length === 0) {
        return res.json({ available: false });
      }

      // Check for conflicting reservations
      const conflicting = await prisma.reservation.findMany({
        where: {
          restaurantId: id,
          date: new Date(date),
          status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
          tableId: { in: tables.map((t) => t.id) },
        },
      });

      const occupiedTableIds = new Set(conflicting.map((r) => r.tableId));
      const available = tables.some((t) => !occupiedTableIds.has(t.id));

      res.json({ available });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/time-slots - Get available time slots for a date
router.get(
  '/:id/time-slots',
  authenticateUser,
  [
    param('id').notEmpty().trim(),
    query('date').isISO8601(),
    query('partySize').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;
      const { date, partySize } = req.query;

      // Check if user is banned
      const bannedRecord = await prisma.bannedUser.findFirst({
        where: { userId, restaurantId: id },
      });
      if (bannedRecord) {
        return res.json({ timeSlots: [], banned: true });
      }

      // Check if this date is disabled
      const dateObj = new Date(date);
      const disabledDate = await prisma.disabledDate.findFirst({
        where: {
          restaurantId: id,
          date: dateObj,
        },
      });
      if (disabledDate) {
        return res.json({ timeSlots: [], disabled: true });
      }

      // Get opening hours for that day
      const jsDay = dateObj.getUTCDay(); // 0=Sun
      const schemaDayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun

      const openingHour = await prisma.openingHours.findFirst({
        where: {
          restaurantId: id,
          dayOfWeek: schemaDayOfWeek,
          isOpen: true,
        },
      });

      if (!openingHour) {
        return res.json({ timeSlots: [], closed: true });
      }

      // Get service periods for this day
      const servicePeriods = await prisma.servicePeriod.findMany({
        where: {
          restaurantId: id,
          daysOfWeek: { has: schemaDayOfWeek },
        },
        orderBy: { startTime: 'asc' },
      });

      // Generate 15-min interval slots within opening hours (or service periods if available)
      const openStart = parseInt(openingHour.openTime.split(':')[0]) * 60 + parseInt(openingHour.openTime.split(':')[1]);
      const openEnd = parseInt(openingHour.closeTime.split(':')[0]) * 60 + parseInt(openingHour.closeTime.split(':')[1]);

      const timeSlots = [];
      const slotSet = new Set();

      if (servicePeriods.length > 0) {
        // Generate slots within each service period
        for (const sp of servicePeriods) {
          const spStart = parseInt(sp.startTime.split(':')[0]) * 60 + parseInt(sp.startTime.split(':')[1]);
          const spEnd = parseInt(sp.endTime.split(':')[0]) * 60 + parseInt(sp.endTime.split(':')[1]);
          // Clamp to opening hours
          const start = Math.max(spStart, openStart);
          const end = Math.min(spEnd, openEnd);
          for (let min = start; min <= end; min += 15) {
            const slotStr = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
            if (!slotSet.has(slotStr)) {
              slotSet.add(slotStr);
              timeSlots.push(slotStr);
            }
          }
        }
      } else {
        // No service periods defined, use opening hours
        for (let min = openStart; min <= openEnd; min += 15) {
          const slotStr = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
          timeSlots.push(slotStr);
        }
      }

      // Sort chronologically
      timeSlots.sort();

      // For same-day bookings, filter out slots less than 30 minutes from now
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      if (date === todayStr) {
        const nowMin = now.getHours() * 60 + now.getMinutes() + 30; // 30-min minimum lead time
        const filtered = timeSlots.filter((slot) => {
          const [h, m] = slot.split(':').map(Number);
          return h * 60 + m >= nowMin;
        });
        return res.json({ timeSlots: filtered, servicePeriods: servicePeriods.map(sp => ({ nameEn: sp.nameEn, nameRo: sp.nameRo, startTime: sp.startTime, endTime: sp.endTime })) });
      }

      res.json({ timeSlots, servicePeriods: servicePeriods.map(sp => ({ nameEn: sp.nameEn, nameRo: sp.nameRo, startTime: sp.startTime, endTime: sp.endTime })) });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
