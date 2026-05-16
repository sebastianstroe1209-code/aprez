const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');
const { EVENTS, dispatchAsync } = require('../services/notifications');

const router = express.Router();

// Helper function to add minutes to time string HH:MM
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// Middleware to check validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// POST / - Create reservation
router.post(
  '/',
  authenticateUser,
  [
    body('restaurantId').notEmpty().trim(),
    body('date').isISO8601(),
    body('time').matches(/^\d{2}:\d{2}$/),
    body('partySize').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { restaurantId, date, time, partySize } = req.body;

      // Check if user is banned
      const bannedRecord = await prisma.bannedUser.findFirst({
        where: { userId, restaurantId },
      });

      if (bannedRecord) {
        return res.status(400).json({ error: 'Not available' });
      }

      // Get restaurant settings
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: {
          id: true,
          reservationDurationMin: true,
          autoConfirmEnabled: true,
          autoConfirmMaxParty: true,
          autoConfirmLeadHours: true,
          maxPartySize: true,
        },
      });

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      if (parseInt(partySize) > restaurant.maxPartySize) {
        return res.status(400).json({ error: `Maximum party size is ${restaurant.maxPartySize}` });
      }

      // Validate reservation is within opening hours
      const dateObj = new Date(date);
      const jsDay = dateObj.getUTCDay(); // 0=Sun
      const schemaDayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun

      const openingHour = await prisma.openingHours.findFirst({
        where: {
          restaurantId,
          dayOfWeek: schemaDayOfWeek,
          isOpen: true,
        },
      });

      if (!openingHour) {
        return res.status(400).json({ error: 'The restaurant is closed on this day' });
      }

      // Check time is within opening hours
      const openStart = parseInt(openingHour.openTime.split(':')[0]) * 60 + parseInt(openingHour.openTime.split(':')[1]);
      const openEnd = parseInt(openingHour.closeTime.split(':')[0]) * 60 + parseInt(openingHour.closeTime.split(':')[1]);
      const [reqH, reqM] = time.split(':').map(Number);
      const reqMin = reqH * 60 + reqM;

      if (reqMin < openStart || reqMin > openEnd) {
        return res.status(400).json({ error: `Reservations are only available between ${openingHour.openTime} and ${openingHour.closeTime}` });
      }

      // Check disabled dates
      const disabledDate = await prisma.disabledDate.findFirst({
        where: { restaurantId, date: dateObj },
      });
      if (disabledDate) {
        return res.status(400).json({ error: 'Reservations are not available on this date' });
      }

      // Enforce minimum 30 minutes lead time for same-day bookings
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const dateStr = dateObj.toISOString().split('T')[0];
      if (dateStr === todayStr) {
        const nowMin = now.getHours() * 60 + now.getMinutes() + 30;
        if (reqMin < nowMin) {
          return res.status(400).json({ error: 'Same-day reservations require at least 30 minutes notice' });
        }
      }

      // Calculate end time
      const duration = restaurant.reservationDurationMin || 120;
      const endTime = addMinutes(time, duration);

      // Find tables that could fit. SPEC §9.3: auto-confirm requires a
      // single table with seat count EXACTLY equal to party size (not just
      // "fits"). Falls through to manual confirm when no exact match exists.
      // SPEC §8.1: skip tables whose CURRENT status is Occupied or Out of
      // Service.
      const pSize = parseInt(partySize);
      const tables = await prisma.restaurantTable.findMany({
        where: {
          restaurantId,
          isActive: true,
          seatCount: pSize,
          status: { notIn: ['OCCUPIED', 'OUT_OF_SERVICE'] },
        },
        orderBy: { seatCount: 'asc' },
        select: { id: true, seatCount: true, sectionId: true },
      });

      // Also check if sections have enough combined capacity for manual confirmation
      let sectionHasCapacity = false;
      if (tables.length === 0) {
        const allTables = await prisma.restaurantTable.findMany({
          where: { restaurantId, isActive: true },
          select: { id: true, seatCount: true, sectionId: true },
        });

        // Group by section and check combined seat counts
        const sectionCapacity = {};
        for (const t of allTables) {
          if (!sectionCapacity[t.sectionId]) sectionCapacity[t.sectionId] = 0;
          sectionCapacity[t.sectionId] += t.seatCount;
        }
        sectionHasCapacity = Object.values(sectionCapacity).some((cap) => cap >= pSize);
      }

      if (tables.length === 0 && !sectionHasCapacity) {
        return res.status(400).json({ error: 'No tables available for this party size' });
      }

      // Check for conflicting reservations on single-fit tables
      let freeTable = null;
      if (tables.length > 0) {
        const conflicting = await prisma.reservation.findMany({
          where: {
            restaurantId,
            date: dateObj,
            status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
            tableId: { in: tables.map((t) => t.id) },
            AND: [
              { time: { lt: endTime } },
              { endTime: { gt: time } },
            ],
          },
        });

        const occupiedTableIds = new Set(conflicting.map((r) => r.tableId));
        freeTable = tables.find((t) => !occupiedTableIds.has(t.id));
      }

      // Determine status
      let status = 'PENDING';
      let tableId = null;

      if (freeTable) {
        // We have a single table that fits
        const reservationDate = new Date(date + 'T' + time + ':00');
        const hoursUntil = (reservationDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (
          restaurant.autoConfirmEnabled &&
          pSize <= (restaurant.autoConfirmMaxParty || 4) &&
          hoursUntil > (restaurant.autoConfirmLeadHours || 24)
        ) {
          status = 'AUTO_CONFIRMED';
          tableId = freeTable.id;
        } else {
          // Manual confirmation needed, but still associate the table suggestion
          tableId = null; // Staff will assign table during confirmation
        }
      }
      // If no single table fits but section has capacity, it stays PENDING for manual combining

      // Create reservation
      const reservation = await prisma.reservation.create({
        data: {
          userId,
          restaurantId,
          date: new Date(date),
          time,
          endTime,
          partySize: parseInt(partySize),
          status,
          tableId,
          source: 'APP',
        },
        select: {
          id: true,
          status: true,
          date: true,
          time: true,
          endTime: true,
          partySize: true,
          createdAt: true,
        },
      });

      const io = req.app.get('io');
      // Diner-side notification only fires for auto-confirmed; pending bookings
      // get the diner notification later when staff confirms or rejects.
      if (reservation.status === 'AUTO_CONFIRMED') {
        dispatchAsync(prisma, io, {
          event: EVENTS.RESERVATION_AUTO_CONFIRMED,
          userId,
          restaurantId,
          date: reservation.date,
          time: reservation.time,
          partySize: reservation.partySize,
        });
      }
      // Restaurant always sees a new reservation appear, auto or pending.
      dispatchAsync(prisma, io, {
        event: EVENTS.RESERVATION_REQUEST_NEW,
        restaurantId,
        userId,
        date: reservation.date,
        time: reservation.time,
        partySize: reservation.partySize,
      });

      // C4 §5a real-time broadcast.
      io.emitToRestaurant(restaurantId, 'reservation:created', reservation);
      if (reservation.status === 'PENDING') {
        io.emitToRestaurant(restaurantId, 'reservation:pending-created', reservation);
        io.emitToAdmins('reservation:pending-created', { ...reservation, restaurantId });
      }
      io.emitToUser(userId, 'reservation:updated', reservation);

      res.status(201).json(reservation);
    } catch (error) {
      next(error);
    }
  }
);

// GET /mine - Get all user's reservations
router.get('/mine', authenticateUser, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const userId = req.user.id;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const reservations = await prisma.reservation.findMany({
      where: {
        userId,
        date: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        restaurantId: true,
        date: true,
        time: true,
        endTime: true,
        partySize: true,
        status: true,
        tableId: true,
        cancelledAt: true,
        cancelledBy: true,
        restaurant: {
          select: {
            id: true,
            nameRo: true,
            nameEn: true,
            cuisineTypes: true,
            address: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    res.json({ reservations });
  } catch (error) {
    next(error);
  }
});

// GET /:id - Get reservation detail
router.get(
  '/:id',
  authenticateUser,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: { id, userId },
        select: {
          id: true,
          restaurantId: true,
          date: true,
          time: true,
          endTime: true,
          partySize: true,
          status: true,
          tableId: true,
          cancelledAt: true,
          cancelledBy: true,
          restaurant: {
            select: {
              id: true,
              nameRo: true,
              nameEn: true,
              address: true,
              phone: true,
              email: true,
            },
          },
          modifications: {
            select: {
              id: true,
              requestedDate: true,
              requestedTime: true,
              requestedPartySize: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      res.json(reservation);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /:id/cancel - Cancel reservation
router.put(
  '/:id/cancel',
  authenticateUser,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: { id, userId },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      if (reservation.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Reservation is already cancelled' });
      }

      const cancelled = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: 'user',
        },
        select: {
          id: true,
          status: true,
          cancelledAt: true,
          cancelledBy: true,
        },
      });

      const io = req.app.get('io');
      dispatchAsync(prisma, io, {
        event: EVENTS.RESERVATION_CANCELLED_BY_DINER,
        restaurantId: reservation.restaurantId,
        userId,
        date: reservation.date,
        time: reservation.time,
      });

      const cancelPayload = { id, restaurantId: reservation.restaurantId, userId, cancelledBy: 'user', ...cancelled };
      io.emitToRestaurant(reservation.restaurantId, 'reservation:cancelled', cancelPayload);
      io.emitToUser(userId, 'reservation:cancelled', cancelPayload);

      res.json(cancelled);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/modify - Request modification
router.post(
  '/:id/modify',
  authenticateUser,
  [
    param('id').isUUID(),
    body('requestedDate').optional().isISO8601(),
    body('requestedTime').optional().matches(/^\d{2}:\d{2}$/),
    body('requestedPartySize').optional().isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;
      const { requestedDate, requestedTime, requestedPartySize } = req.body;

      const reservation = await prisma.reservation.findFirst({
        where: { id, userId },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      if (reservation.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Cannot modify a cancelled reservation' });
      }

      const modification = await prisma.reservationModification.create({
        data: {
          reservationId: id,
          requestedDate: requestedDate ? new Date(requestedDate) : null,
          requestedTime: requestedTime || null,
          requestedPartySize: requestedPartySize ? parseInt(requestedPartySize) : null,
          status: 'PENDING',
        },
        select: {
          id: true,
          requestedDate: true,
          requestedTime: true,
          requestedPartySize: true,
          status: true,
          createdAt: true,
        },
      });

      const detailParts = [];
      if (modification.requestedDate) detailParts.push(`date → ${new Date(modification.requestedDate).toISOString().slice(0, 10)}`);
      if (modification.requestedTime) detailParts.push(`time → ${modification.requestedTime}`);
      if (modification.requestedPartySize) detailParts.push(`party → ${modification.requestedPartySize}`);
      const io = req.app.get('io');
      dispatchAsync(prisma, io, {
        event: EVENTS.MODIFICATION_REQUESTED,
        restaurantId: reservation.restaurantId,
        userId,
        date: reservation.date,
        time: reservation.time,
        details: detailParts.join(', '),
      });

      // §5a: surface the modification-pending state as a reservation update
      // so the restaurant + diner lists refresh without re-fetch.
      io.emitToRestaurant(reservation.restaurantId, 'reservation:updated', {
        id: reservation.id,
        restaurantId: reservation.restaurantId,
        userId,
        modificationPending: modification,
      });
      io.emitToUser(userId, 'reservation:updated', {
        id: reservation.id,
        restaurantId: reservation.restaurantId,
        userId,
        modificationPending: modification,
      });

      res.status(201).json(modification);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
