const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateRestaurant } = require('../middleware/auth');
const { EVENTS, dispatchAsync } = require('../services/notifications');

const router = express.Router();

// Helper functions
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function generateUsername(name) {
  const base = name.toLowerCase().replace(/\s+/g, '');
  const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${base}${suffix}`;
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Middleware for validation error handling
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ============================================
// RESERVATION MANAGEMENT
// ============================================

// GET /reservations - Get all reservations for this restaurant
router.get(
  '/reservations',
  authenticateRestaurant,
  [
    query('date').optional().isISO8601(),
    query('status').optional().isIn(['PENDING', 'CONFIRMED', 'AUTO_CONFIRMED', 'MODIFICATION_PENDING', 'CANCELLED', 'COMPLETED', 'NO_SHOW']),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { date, status } = req.query;

      // Column is @db.Date; build the day window in UTC so the boundary doesn't
      // drift with the server's local TZ. When ?date=YYYY-MM-DD is supplied we
      // return rows for THAT day only (exact match). With no date param we
      // default to "today (Europe/Bucharest) onward" — the upcoming list view.
      const where = { restaurantId };
      if (date) {
        const dayStart = new Date(`${date}T00:00:00.000Z`);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        where.date = { gte: dayStart, lt: dayEnd };
      } else {
        const todayBucharest = new Date().toLocaleDateString('en-CA', {
          timeZone: 'Europe/Bucharest',
        });
        where.date = { gte: new Date(`${todayBucharest}T00:00:00.000Z`) };
      }

      if (status) {
        where.status = status;
      }

      const reservations = await prisma.reservation.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          table: {
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
              status: true,
            },
          },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
      });

      res.json(reservations);
    } catch (error) {
      next(error);
    }
  }
);

// GET /reservations/pending - Get pending reservations
router.get('/reservations/pending', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        status: 'PENDING',
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        table: {
          select: {
            id: true,
            tableNumber: true,
            seatCount: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });

    res.json(reservations);
  } catch (error) {
    next(error);
  }
});

// GET /reservations/search - Search reservations
router.get(
  '/reservations/search',
  authenticateRestaurant,
  [query('q').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { q } = req.query;

      // Search by name, phone, email, time, or party size
      const searchNumber = parseInt(q);
      const isTime = /^\d{2}:\d{2}$/.test(q);

      const reservations = await prisma.reservation.findMany({
        where: {
          restaurantId,
          OR: [
            { guestName: { contains: q, mode: 'insensitive' } },
            { guestPhone: { contains: q, mode: 'insensitive' } },
            { guestEmail: { contains: q, mode: 'insensitive' } },
            { user: { firstName: { contains: q, mode: 'insensitive' } } },
            { user: { lastName: { contains: q, mode: 'insensitive' } } },
            { user: { phone: { contains: q, mode: 'insensitive' } } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            ...(isTime ? [{ time: q }] : []),
            ...(!isNaN(searchNumber) ? [{ partySize: searchNumber }] : []),
          ],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          table: {
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
            },
          },
        },
        orderBy: [{ date: 'desc' }, { time: 'desc' }],
        take: 50,
      });

      res.json(reservations);
    } catch (error) {
      next(error);
    }
  }
);

// GET /reservations/:id/eligible-tables - Tables available for this reservation
// Returns the reservation summary plus active tables with enough seats AND no
// reservation overlapping [reservation.time, reservation.endTime] on the date.
// Bundling them avoids a second round trip from the floor-plan confirm flow.
router.get(
  '/reservations/:id/eligible-tables',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: { id, restaurantId },
        select: {
          id: true,
          status: true,
          partySize: true,
          date: true,
          time: true,
          endTime: true,
          guestName: true,
          tableId: true,
          user: {
            select: { firstName: true, lastName: true },
          },
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // SPEC §8.1: exclude tables whose CURRENT status is Occupied or Out of
      // Service, in addition to the time-overlap exclusion below. A 6-seat
      // table currently held by a walk-in must not be offered as eligible
      // even if no future reservation conflicts at the requested time.
      const tables = await prisma.restaurantTable.findMany({
        where: {
          restaurantId,
          isActive: true,
          seatCount: { gte: reservation.partySize },
          status: { notIn: ['OCCUPIED', 'OUT_OF_SERVICE'] },
        },
        select: { id: true },
      });

      if (tables.length === 0) {
        return res.json({ reservation, eligibleTableIds: [] });
      }

      const conflicting = await prisma.reservation.findMany({
        where: {
          restaurantId,
          date: reservation.date,
          id: { not: reservation.id },
          tableId: { in: tables.map((t) => t.id) },
          status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
        },
        select: { tableId: true, time: true, endTime: true },
      });

      const occupiedTableIds = new Set(
        conflicting
          .filter((r) => r.time < reservation.endTime && r.endTime > reservation.time)
          .map((r) => r.tableId)
      );

      const eligibleTableIds = tables
        .filter((t) => !occupiedTableIds.has(t.id))
        .map((t) => t.id);

      res.json({ reservation, eligibleTableIds });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/confirm - Confirm reservation and assign table
router.put(
  '/reservations/:id/confirm',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('tableId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;
      const { tableId } = req.body;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      if (reservation.status === 'CONFIRMED' || reservation.status === 'AUTO_CONFIRMED') {
        return res.status(400).json({ error: 'Reservation is already confirmed' });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          tableId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          table: {
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
            },
          },
        },
      });

      if (updated.userId) {
        dispatchAsync(prisma, req.app.get('io'), {
          event: EVENTS.RESERVATION_CONFIRMED,
          userId: updated.userId,
          restaurantId,
          date: updated.date,
          time: updated.time,
          partySize: updated.partySize,
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/reject - Reject reservation
router.put(
  '/reservations/:id/reject',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      if (reservation.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Reservation is already cancelled' });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: 'restaurant',
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (updated.userId) {
        dispatchAsync(prisma, req.app.get('io'), {
          event: EVENTS.RESERVATION_REJECTED,
          userId: updated.userId,
          restaurantId,
          date: updated.date,
          time: updated.time,
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/assign-table - Reassign table
router.put(
  '/reservations/:id/assign-table',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('tableId').isUUID(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;
      const { tableId } = req.body;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // SPEC §8.1: reject if the target table is currently Occupied or Out of
      // Service, regardless of when the reservation is for.
      const targetTable = await prisma.restaurantTable.findFirst({
        where: { id: tableId, restaurantId },
        select: { status: true, tableNumber: true },
      });
      if (!targetTable) {
        return res.status(404).json({ error: 'Table not found' });
      }
      if (targetTable.status === 'OCCUPIED' || targetTable.status === 'OUT_OF_SERVICE') {
        return res.status(409).json({
          error: `Cannot assign: table ${targetTable.tableNumber} is ${targetTable.status === 'OCCUPIED' ? 'occupied' : 'out of service'}.`,
        });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: { tableId },
        include: {
          table: {
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
            },
          },
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/cancel - Cancel by restaurant
router.put(
  '/reservations/:id/cancel',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: 'restaurant',
        },
      });

      if (updated.userId) {
        dispatchAsync(prisma, req.app.get('io'), {
          event: EVENTS.RESERVATION_CANCELLED_BY_RESTAURANT,
          userId: updated.userId,
          restaurantId,
          date: updated.date,
          time: updated.time,
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /reservations - Create manual reservation
router.post(
  '/reservations',
  authenticateRestaurant,
  [
    body('guestName').notEmpty().trim(),
    body('guestPhone').notEmpty().trim(),
    body('date').isISO8601(),
    body('time').matches(/^\d{2}:\d{2}$/),
    body('partySize').isInt({ min: 1 }),
    body('tableId').optional().isUUID(),
    body('specialRequests').optional({ nullable: true }).isString(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { guestName, guestPhone, guestEmail, date, time, partySize, tableId, specialRequests } = req.body;

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { reservationDurationMin: true },
      });

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const endTime = addMinutes(time, restaurant.reservationDurationMin);

      const reservation = await prisma.reservation.create({
        data: {
          restaurantId,
          guestName,
          guestPhone,
          guestEmail,
          date: new Date(date),
          time,
          endTime,
          partySize: parseInt(partySize),
          tableId,
          specialRequests: specialRequests || null,
          source: 'MANUAL',
          // Spec §9.5: staff-created reservations auto-confirm. tableId is
          // optional at create time; if missing, staff assigns one via the
          // floor-plan flow afterwards.
          status: 'AUTO_CONFIRMED',
        },
        include: {
          table: {
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
            },
          },
        },
      });

      res.status(201).json(reservation);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/seat - Mark as seated
router.put(
  '/reservations/:id/seat',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('actualPartySize').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;
      const { actualPartySize } = req.body;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // SPEC §8.1 seating eligibility: cannot seat onto a table whose
      // current status is Occupied or Out of Service. Backend enforces this
      // even if the UI somehow allows the click.
      if (reservation.tableId) {
        const table = await prisma.restaurantTable.findUnique({
          where: { id: reservation.tableId },
          select: { status: true, tableNumber: true },
        });
        if (table && (table.status === 'OCCUPIED' || table.status === 'OUT_OF_SERVICE')) {
          return res.status(409).json({
            error: `Cannot seat: table ${table.tableNumber} is ${table.status === 'OCCUPIED' ? 'occupied' : 'out of service'}.`,
          });
        }
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          seatedAt: new Date(),
          actualPartySize,
        },
      });

      // Update table status to OCCUPIED if tableId exists
      if (updated.tableId) {
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: {
            status: 'OCCUPIED',
            statusChangedAt: new Date(),
          },
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/complete - Mark as completed
router.put(
  '/reservations/:id/complete',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'COMPLETED',
        },
      });

      // Free up the table if it was occupied
      if (updated.tableId) {
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: {
            status: 'FREE',
            statusChangedAt: new Date(),
          },
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/no-show - Mark as no-show
router.put(
  '/reservations/:id/no-show',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const reservation = await prisma.reservation.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'NO_SHOW',
        },
      });

      // Free up the table
      if (updated.tableId) {
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: {
            status: 'FREE',
            statusChangedAt: new Date(),
          },
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /modifications/:id/approve - Approve modification request
router.put(
  '/modifications/:id/approve',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const modification = await prisma.reservationModification.findFirst({
        where: {
          id,
          reservation: { restaurantId },
        },
        include: { reservation: true },
      });

      if (!modification) {
        return res.status(404).json({ error: 'Modification not found' });
      }

      const updateData = {};
      if (modification.requestedDate) {
        updateData.date = modification.requestedDate;
      }
      if (modification.requestedTime) {
        updateData.time = modification.requestedTime;
      }
      if (modification.requestedPartySize) {
        updateData.partySize = modification.requestedPartySize;
      }

      // Update the reservation with the new values
      const reservationAfter = await prisma.reservation.update({
        where: { id: modification.reservationId },
        data: updateData,
      });

      // Mark modification as approved
      const updated = await prisma.reservationModification.update({
        where: { id },
        data: {
          status: 'APPROVED',
          resolvedAt: new Date(),
        },
      });

      if (reservationAfter.userId) {
        dispatchAsync(prisma, req.app.get('io'), {
          event: EVENTS.MODIFICATION_APPROVED,
          userId: reservationAfter.userId,
          restaurantId,
          date: reservationAfter.date,
          time: reservationAfter.time,
          partySize: reservationAfter.partySize,
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /modifications/:id/reject - Reject modification request
router.put(
  '/modifications/:id/reject',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const modification = await prisma.reservationModification.findFirst({
        where: {
          id,
          reservation: { restaurantId },
        },
        include: { reservation: { select: { id: true, userId: true, date: true, time: true } } },
      });

      if (!modification) {
        return res.status(404).json({ error: 'Modification not found' });
      }

      const updated = await prisma.reservationModification.update({
        where: { id },
        data: {
          status: 'REJECTED',
          resolvedAt: new Date(),
        },
      });

      if (modification.reservation && modification.reservation.userId) {
        dispatchAsync(prisma, req.app.get('io'), {
          event: EVENTS.MODIFICATION_REJECTED,
          userId: modification.reservation.userId,
          restaurantId,
          date: modification.reservation.date,
          time: modification.reservation.time,
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// TABLE & LAYOUT MANAGEMENT
// ============================================

// GET /layout - Get all sections with tables
router.get('/layout', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;

    const sections = await prisma.tableSection.findMany({
      where: { restaurantId },
      include: {
        tables: {
          where: { isActive: true },
          select: {
            id: true,
            tableNumber: true,
            seatCount: true,
            gridRow: true,
            gridCol: true,
            status: true,
            statusChangedAt: true,
          },
          orderBy: [{ gridRow: 'asc' }, { gridCol: 'asc' }],
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    res.json(sections);
  } catch (error) {
    next(error);
  }
});

// GET /layout/:sectionId - Get specific section with tables
router.get(
  '/layout/:sectionId',
  authenticateRestaurant,
  [param('sectionId').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { sectionId } = req.params;

      const section = await prisma.tableSection.findFirst({
        where: {
          id: sectionId,
          restaurantId,
        },
        include: {
          tables: {
            where: { isActive: true },
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
              gridRow: true,
              gridCol: true,
              status: true,
              statusChangedAt: true,
            },
            orderBy: [{ gridRow: 'asc' }, { gridCol: 'asc' }],
          },
        },
      });

      if (!section) {
        return res.status(404).json({ error: 'Section not found' });
      }

      res.json(section);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /tables/:id/status - Update table status
router.put(
  '/tables/:id/status',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('status').isIn(['FREE', 'OCCUPIED', 'ARRIVING_SOON', 'AWAITING_GUEST', 'OUT_OF_SERVICE']),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;
      const { status } = req.body;

      const updated = await prisma.restaurantTable.update({
        where: { id },
        data: {
          status,
          statusChangedAt: new Date(),
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /tables/:id/seat - Mark table as taken for walk-in
router.put(
  '/tables/:id/seat',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('guestCount').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;
      const { guestCount } = req.body;

      const updated = await prisma.restaurantTable.update({
        where: { id },
        data: {
          status: 'OCCUPIED',
          statusChangedAt: new Date(),
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /tables/move - Move table
router.post(
  '/tables/move',
  authenticateRestaurant,
  [
    body('tableId').isUUID(),
    body('movedGridRow').isInt(),
    body('movedGridCol').isInt(),
    body('mergedWithTableId').optional().isUUID(),
    body('date').isISO8601(),
    body('timeStart').matches(/^\d{2}:\d{2}$/),
    body('timeEnd').matches(/^\d{2}:\d{2}$/),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { tableId, movedGridRow, movedGridCol, mergedWithTableId, date, timeStart, timeEnd } = req.body;

      const table = await prisma.restaurantTable.findFirst({
        where: {
          id: tableId,
          restaurantId,
        },
      });

      if (!table) {
        return res.status(404).json({ error: 'Table not found' });
      }

      const move = await prisma.tableMove.create({
        data: {
          tableId,
          originalGridRow: table.gridRow,
          originalGridCol: table.gridCol,
          movedGridRow,
          movedGridCol,
          mergedWithTableId,
          date: new Date(date),
          timeStart,
          timeEnd,
          isActive: true,
        },
      });

      res.status(201).json(move);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /tables/:id/unmerge - Move table back to original position
router.put(
  '/tables/:id/unmerge',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const table = await prisma.restaurantTable.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!table) {
        return res.status(404).json({ error: 'Table not found' });
      }

      // Find and deactivate active TableMove for this table
      const activeMove = await prisma.tableMove.findFirst({
        where: {
          tableId: id,
          isActive: true,
        },
      });

      if (activeMove) {
        await prisma.tableMove.update({
          where: { id: activeMove.id },
          data: { isActive: false },
        });
      }

      res.json({ success: true, message: 'Table unmerged' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /layout/live - Get current LIVE data
router.get('/layout/live', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;
    const now = new Date();

    const tables = await prisma.restaurantTable.findMany({
      where: {
        restaurantId,
        isActive: true,
      },
      include: {
        reservations: {
          where: {
            date: {
              gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            },
            status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] },
          },
          select: {
            id: true,
            time: true,
            endTime: true,
            partySize: true,
            status: true,
          },
        },
      },
    });

    // Calculate occupancy durations and identify alerts
    const tablesWithStatus = tables.map((table) => {
      let occupancyDurationMin = null;
      let hasAlert = false;

      if (table.status === 'OCCUPIED' && table.statusChangedAt) {
        const minutes = Math.floor((now.getTime() - table.statusChangedAt.getTime()) / (1000 * 60));
        occupancyDurationMin = minutes;

        // Red alert if table occupied for > 2 hours
        if (minutes > 120) {
          hasAlert = true;
        }
      }

      return {
        ...table,
        occupancyDurationMin,
        hasAlert,
      };
    });

    res.json(tablesWithStatus);
  } catch (error) {
    next(error);
  }
});

// Waitlist routes (GET /waitlist, /waitlist/suggestions, POST /waitlist/:id/notify,
// DELETE /waitlist/:id) removed — SPEC §6.6 cuts the waitlist system entirely.

// ============================================
// BAN MANAGEMENT
// ============================================

// POST /bans - Ban a user
router.post(
  '/bans',
  authenticateRestaurant,
  [
    body('userId').optional().isUUID(),
    body('phone').optional().trim(),
    body('email').optional().isEmail(),
    body('name').optional().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { userId, phone, email, name } = req.body;

      let targetUserId = userId;

      // If userId not provided, search by phone, email, or name
      if (!userId) {
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              ...(phone ? [{ phone }] : []),
              ...(email ? [{ email }] : []),
              ...(name ? [{ OR: [{ firstName: name }, { lastName: name }] }] : []),
            ],
          },
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        targetUserId = user.id;
      }

      const ban = await prisma.bannedUser.create({
        data: {
          userId: targetUserId,
          restaurantId,
          bannedBy: 'restaurant',
        },
      });

      res.status(201).json(ban);
    } catch (error) {
      next(error);
    }
  }
);

// GET /bans - Get all banned users
router.get('/bans', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;

    const bans = await prisma.bannedUser.findMany({
      where: { restaurantId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(bans);
  } catch (error) {
    next(error);
  }
});

// DELETE /bans/:id - Unban
router.delete(
  '/bans/:id',
  authenticateRestaurant,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;

      const ban = await prisma.bannedUser.findFirst({
        where: {
          id,
          restaurantId,
        },
      });

      if (!ban) {
        return res.status(404).json({ error: 'Ban not found' });
      }

      await prisma.bannedUser.delete({ where: { id } });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PROFILE MANAGEMENT
// ============================================

// GET /profile - Get restaurant profile
router.get('/profile', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        openingHours: { orderBy: { dayOfWeek: 'asc' } },
        servicePeriods: true,
      },
    });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    res.json(restaurant);
  } catch (error) {
    next(error);
  }
});

// PUT /profile - Update restaurant profile
router.put(
  '/profile',
  authenticateRestaurant,
  [
    body('descriptionRo').optional().trim(),
    body('descriptionEn').optional().trim(),
    body('phone').optional().trim(),
    body('email').optional().trim(),
    body('website').optional().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { descriptionRo, descriptionEn, phone, email, website } = req.body;

      const updateData = {};
      if (descriptionRo !== undefined) updateData.descriptionRo = descriptionRo;
      if (descriptionEn !== undefined) updateData.descriptionEn = descriptionEn;
      if (phone !== undefined) updateData.phone = phone;
      if (email !== undefined) updateData.email = email;
      if (website !== undefined) updateData.website = website;

      const updated = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: updateData,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /settings - Update settings
router.put(
  '/settings',
  authenticateRestaurant,
  [body('autoConfirmEnabled').isBoolean()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { autoConfirmEnabled } = req.body;

      const updated = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { autoConfirmEnabled },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// CALENDAR
// ============================================

// GET /calendar - Get calendar view
router.get(
  '/calendar',
  authenticateRestaurant,
  [
    query('date').optional().isISO8601(),
    query('sectionId').optional().isUUID(),
    query('servicePeriodId').optional().isUUID(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { date, sectionId, servicePeriodId } = req.query;

      const filterDate = date ? new Date(date) : new Date();
      filterDate.setHours(0, 0, 0, 0);

      let sectionFilter = { restaurantId };
      if (sectionId) {
        sectionFilter.id = sectionId;
      }

      const sections = await prisma.tableSection.findMany({
        where: sectionFilter,
        include: {
          tables: {
            where: { isActive: true },
            include: {
              reservations: {
                where: {
                  date: filterDate,
                  status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] },
                },
              },
            },
          },
        },
      });

      // Map reservations to time slots
      const calendar = sections.map((section) => ({
        sectionId: section.id,
        sectionName: section.nameEn,
        gridRows: section.gridRows,
        gridColumns: section.gridColumns,
        tables: section.tables.map((table) => ({
          tableId: table.id,
          tableNumber: table.tableNumber,
          seatCount: table.seatCount,
          gridRow: table.gridRow,
          gridCol: table.gridCol,
          reservations: table.reservations.map((res) => ({
            reservationId: res.id,
            time: res.time,
            endTime: res.endTime,
            partySize: res.partySize,
          })),
        })),
      }));

      res.json(calendar);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
