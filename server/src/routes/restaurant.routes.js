const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');
const { computeMergeSuggestions } = require('../lib/tableMerges');
const { timeMinutesFitsOpenWindow, timeWithinServicePeriods } = require('../lib/openingHours');

const router = express.Router();

// Add `minutes` to an HH:mm time string, returning HH:mm.
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// Group an array of rows into a Map keyed by `row[key]`.
function groupBy(rows, key) {
  const m = new Map();
  for (const row of rows) {
    if (!m.has(row[key])) m.set(row[key], []);
    m.get(row[key]).push(row);
  }
  return m;
}

// Tier G commit 5b — diner home availability join (SPEC §5.1).
//
// Given a list of restaurants the diner can already see (cuisine /
// search / banned filters applied), keep only those that could seat
// `partySize` for the requested `date` + `time` over a flat 120-minute
// window. A restaurant qualifies when AT LEAST ONE seating arrangement
// works: a single free table that fits the party, OR a feasible merge
// of adjacent free tables summing to ≥ partySize (same BFS the staff
// Quick-Add uses, via lib/tableMerges.computeMergeSuggestions).
//
// Design notes:
//   * Every per-restaurant lookup is BATCHED — 5 queries total, not
//     5×N — keyed back to each restaurant in memory.
//   * The window is a flat 120 min (the SPEC default
//     reservationDurationMin). A venue with a custom duration is
//     filtered slightly approximately; per the G5b brief, "reasonable
//     filtering" on the home list is the goal, not staff-grade
//     precision.
//   * Bias is toward FALSE POSITIVES: the single-table check uses
//     seatCount ≥ partySize (not exact), because a larger free table
//     still seats the party — excluding it would be a false negative,
//     and the diner sees an honest "no tables" only if they actually
//     try to book. Stale data between this join and the booking POST
//     is an accepted race.
async function filterByAvailability(prisma, restaurants, date, time, partySize) {
  const ids = restaurants.map((r) => r.id);
  const dateObj = new Date(date);
  const jsDay = dateObj.getUTCDay(); // 0=Sun
  const schemaDayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
  const requestedEnd = addMinutes(time, 120);

  const [openingHours, servicePeriods, disabledRows, tables, reservations] = await Promise.all([
    prisma.openingHours.findMany({
      where: { restaurantId: { in: ids }, dayOfWeek: schemaDayOfWeek, isOpen: true },
      select: { restaurantId: true, openTime: true, closeTime: true },
    }),
    prisma.servicePeriod.findMany({
      where: { restaurantId: { in: ids }, daysOfWeek: { has: schemaDayOfWeek } },
      select: { restaurantId: true, startTime: true, endTime: true },
    }),
    prisma.disabledDate.findMany({
      where: { restaurantId: { in: ids }, date: dateObj },
      select: { restaurantId: true },
    }),
    prisma.restaurantTable.findMany({
      where: {
        restaurantId: { in: ids },
        isActive: true,
        status: { notIn: ['OCCUPIED', 'OUT_OF_SERVICE'] },
      },
      select: {
        id: true, restaurantId: true, tableNumber: true,
        seatCount: true, gridRow: true, gridCol: true, sectionId: true,
      },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId: { in: ids },
        date: dateObj,
        status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
        tableId: { not: null },
        AND: [{ time: { lt: requestedEnd } }, { endTime: { gt: time } }],
      },
      select: { restaurantId: true, tableId: true },
    }),
  ]);

  const openByR = new Map(openingHours.map((o) => [o.restaurantId, o]));
  const periodsByR = groupBy(servicePeriods, 'restaurantId');
  const disabledR = new Set(disabledRows.map((d) => d.restaurantId));
  const tablesByR = groupBy(tables, 'restaurantId');
  const busyByR = new Map();
  for (const rv of reservations) {
    if (!busyByR.has(rv.restaurantId)) busyByR.set(rv.restaurantId, new Set());
    busyByR.get(rv.restaurantId).add(rv.tableId);
  }

  const out = [];
  for (const r of restaurants) {
    if (disabledR.has(r.id)) continue; // restaurant marked this date unavailable
    const oh = openByR.get(r.id);
    if (!oh || !timeMinutesFitsOpenWindow(time, oh.openTime, oh.closeTime)) continue; // closed
    if (!timeWithinServicePeriods(time, periodsByR.get(r.id) || [])) continue; // outside service period

    const rTables = tablesByR.get(r.id) || [];
    const busy = busyByR.get(r.id) || new Set();
    const freeTables = rTables.filter((t) => !busy.has(t.id));

    // A single free table that fits the party (permissive: ≥, not exact).
    let qualifies = freeTables.some((t) => t.seatCount >= partySize);
    // …otherwise an adjacent merge of free tables that sums to ≥ party.
    if (!qualifies && freeTables.length >= 2) {
      const merges = await computeMergeSuggestions(
        prisma, r.id, rTables, dateObj, time, requestedEnd, partySize, busy
      );
      qualifies = merges.length > 0;
    }
    if (qualifies) out.push(r);
  }
  return out;
}

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

      // Tier G commit 5b — party/date/time availability filter (§5.1).
      // ALL-OR-NONE: the filter engages only when all three params are
      // present; any subset is ignored and the list behaves exactly as
      // before. Each param is still format-validated when present (so a
      // malformed value 400s rather than silently no-op'ing), with a
      // structured { error: { code } } body matching the Tier E/F
      // contract.
      const { partySize: qParty, date: qDate, time: qTime } = req.query;

      let pSize = null;
      if (qParty !== undefined) {
        pSize = Number(qParty);
        if (!Number.isInteger(pSize) || pSize < 1 || pSize > 30) {
          return res.status(400).json({
            error: { code: 'invalid-party-size', message: 'Party size must be a whole number between 1 and 30.' },
          });
        }
      }
      if (qDate !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(qDate) || Number.isNaN(new Date(`${qDate}T00:00:00Z`).getTime())) {
          return res.status(400).json({
            error: { code: 'invalid-date', message: 'Date must be a valid YYYY-MM-DD date.' },
          });
        }
        // "Today" in Europe/Bucharest — string-comparable with qDate.
        const todayBucharest = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date());
        if (qDate < todayBucharest) {
          return res.status(400).json({
            error: { code: 'date-in-past', message: 'Date must be today or in the future.' },
          });
        }
      }
      if (qTime !== undefined && !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(qTime)) {
        return res.status(400).json({
          error: { code: 'invalid-time', message: 'Time must be HH:mm on a 15-minute boundary.' },
        });
      }
      const filterEngaged = qParty !== undefined && qDate !== undefined && qTime !== undefined;

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

      // Availability join (G5b) — runs after cuisine/search/banned so it
      // only inspects the restaurants the diner would otherwise see, and
      // before the distance sort so the ordering reflects the filtered
      // set. Composes with every existing param.
      if (filterEngaged && restaurants.length > 0) {
        restaurants = await filterByAvailability(prisma, restaurants, qDate, qTime, pSize);
      }

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

// GET /:id/disabled-dates — diner-facing list of dates the restaurant
// has marked unavailable. Used by the mobile date picker to gray out
// dates client-side, in addition to the server-side enforcement already
// in /time-slots and POST /reservations. Returns `[{ date, reason? }, …]`.
// Tier F commit 2.
router.get(
  '/:id/disabled-dates',
  authenticateUser,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      // Skip past dates — they can't be booked anyway, and shipping
      // them clutters the picker payload for restaurants with a long
      // history of closures.
      const todayMidnight = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
      const rows = await prisma.disabledDate.findMany({
        where: { restaurantId: req.params.id, date: { gte: todayMidnight } },
        select: { date: true, reason: true },
        orderBy: { date: 'asc' },
      });
      res.json(rows);
    } catch (e) { next(e); }
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

      // Compute the requested reservation's window using the restaurant's
      // configured duration (default 120 minutes). Without this, the prior
      // implementation treated the whole day as a single slot — a 12:00 booking
      // would falsely block a 19:00 booking on the same date.
      const restaurant = await prisma.restaurant.findUnique({
        where: { id },
        select: { reservationDurationMin: true },
      });
      const durationMin = restaurant?.reservationDurationMin || 120;
      const requestedEndTime = addMinutes(time, durationMin);

      const sameDay = await prisma.reservation.findMany({
        where: {
          restaurantId: id,
          date: new Date(date),
          status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
          tableId: { in: tables.map((t) => t.id) },
        },
        select: { tableId: true, time: true, endTime: true },
      });

      // Time overlap: existing.time < requestedEnd AND existing.endTime > requested.
      // Boundary-touching back-to-back bookings (existing endTime == requested time)
      // do not collide.
      const occupiedTableIds = new Set(
        sameDay
          .filter((r) => r.time < requestedEndTime && r.endTime > time)
          .map((r) => r.tableId)
      );
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
