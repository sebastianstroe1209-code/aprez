const express = require('express');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateRestaurant } = require('../middleware/auth');
const { EVENTS, dispatchAsync } = require('../services/notifications');
const {
  MAX_MERGE_MEMBERS,
  MIN_MERGE_MEMBERS,
  combinedLabel,
  isConnectedByAdjacency,
  timeRangesOverlap,
  loadMergeGroup,
  activeMergeMapForRestaurant,
  findActiveMergeForTable,
  deactivateMergesForReservation,
  computeMergeSuggestions,
} = require('../lib/tableMerges');
const { ROMANIAN_PHONE_RE, PHONE_FORMAT_MSG, phoneFormatErrorBody } = require('../lib/phoneValidation');
const { applyOpeningHours, applyServicePeriods } = require('../lib/restaurantProfile');

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
    const arr = errors.array();
    // SPEC §3.1: a guest-phone-format failure gets the structured
    // error.code contract; other failures keep the legacy shape.
    const phoneBody = phoneFormatErrorBody(arr);
    if (phoneBody) return res.status(400).json(phoneBody);
    return res.status(400).json({ errors: arr });
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
          // Tier E commit 1 — include any outstanding PENDING modification
          // so the new restaurant "Modifications" tab can filter without a
          // second round-trip. Take 1 (one-at-a-time is enforced server-
          // side by the modification-already-pending 409 in POST /modify).
          modifications: {
            where: { status: 'PENDING' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
      });

      // Tier I commit 3 — surface merge binding per reservation row.
      // When the reservation's tableId is part of an active merge group
      // whose window covers the reservation's time, the calendar block
      // and reservations row need to display the combined label. One
      // batched query fetches every merge for any tableId in the
      // result set; we filter to overlapping windows in-memory.
      const tableIds = reservations.map((r) => r.tableId).filter(Boolean);
      let mergesByTableId = new Map(); // tableId → merge sub-object
      if (tableIds.length > 0) {
        const activeMoves = await prisma.tableMove.findMany({
          where: {
            isActive: true,
            mergeGroupId: { not: null },
            tableId: { in: tableIds },
          },
          select: {
            mergeGroupId: true, tableId: true,
            timeStart: true, timeEnd: true, date: true,
          },
        });
        // For each (tableId, reservation.time/endTime), check if there's
        // an overlapping merge. Pull all members of matching groups.
        const matchingGroupIds = new Set();
        for (const r of reservations) {
          if (!r.tableId) continue;
          const move = activeMoves.find((m) =>
            m.tableId === r.tableId &&
            m.date.getTime() === new Date(r.date).getTime() &&
            timeRangesOverlap(m.timeStart, m.timeEnd, r.time, r.endTime)
          );
          if (move) matchingGroupIds.add(move.mergeGroupId);
        }
        if (matchingGroupIds.size > 0) {
          const groupMembers = await prisma.tableMove.findMany({
            where: { mergeGroupId: { in: [...matchingGroupIds] }, isActive: true },
            include: { table: { select: { id: true, tableNumber: true, seatCount: true } } },
          });
          // Build per-group metadata.
          const groupMeta = new Map(); // groupId → { combinedLabel, memberLabels, summedSeatCount, memberTableIds }
          for (const row of groupMembers) {
            if (!groupMeta.has(row.mergeGroupId)) {
              groupMeta.set(row.mergeGroupId, { members: [] });
            }
            groupMeta.get(row.mergeGroupId).members.push(row.table);
          }
          for (const [groupId, meta] of groupMeta.entries()) {
            const sortedLabels = meta.members.map((m) => m.tableNumber).sort((a, b) => {
              const na = parseInt(String(a).replace(/^T/i, ''), 10);
              const nb = parseInt(String(b).replace(/^T/i, ''), 10);
              if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
              return String(a).localeCompare(String(b));
            });
            meta.combinedLabel = sortedLabels.join('+');
            meta.memberLabels = sortedLabels;
            meta.summedSeatCount = meta.members.reduce((acc, m) => acc + (m.seatCount || 0), 0);
            meta.memberTableIds = meta.members.map((m) => m.id);
          }
          for (const r of reservations) {
            if (!r.tableId) continue;
            const move = activeMoves.find((m) =>
              m.tableId === r.tableId &&
              m.date.getTime() === new Date(r.date).getTime() &&
              timeRangesOverlap(m.timeStart, m.timeEnd, r.time, r.endTime)
            );
            if (!move || !groupMeta.has(move.mergeGroupId)) continue;
            const meta = groupMeta.get(move.mergeGroupId);
            // otherMembers: labels EXCLUDING this row's table (so the
            // calendar block in T1's column can read "+T3" not "T1+T3").
            const selfLabel = meta.members.find((m) => m.id === r.tableId)?.tableNumber;
            mergesByTableId.set(r.id, {
              groupId: move.mergeGroupId,
              combinedLabel: meta.combinedLabel,
              memberLabels: meta.memberLabels,
              otherMemberLabels: meta.memberLabels.filter((l) => l !== selfLabel),
              summedSeatCount: meta.summedSeatCount,
            });
          }
        }
      }

      // Flatten: client expects modificationPending: row | null, not an
      // array. Keep `modifications` off the wire — the popup + tab only
      // need to know if there's one pending.
      const shaped = reservations.map((r) => {
        const { modifications, ...rest } = r;
        return {
          ...rest,
          modificationPending: modifications && modifications[0] ? modifications[0] : null,
          mergeBinding: mergesByTableId.get(r.id) || null,
        };
      });

      res.json(shaped);
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

      const io = req.app.get('io');
      if (updated.userId) {
        dispatchAsync(prisma, io, {
          event: EVENTS.RESERVATION_CONFIRMED,
          userId: updated.userId,
          restaurantId,
          date: updated.date,
          time: updated.time,
          partySize: updated.partySize,
        });
      }
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);

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

      const io = req.app.get('io');
      if (updated.userId) {
        dispatchAsync(prisma, io, {
          event: EVENTS.RESERVATION_REJECTED,
          userId: updated.userId,
          restaurantId,
          date: updated.date,
          time: updated.time,
        });
      }
      const rejectPayload = { ...updated, cancelledBy: 'restaurant', reason: 'rejected' };
      io.emitToRestaurant(restaurantId, 'reservation:cancelled', rejectPayload);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:cancelled', rejectPayload);

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/assign-table - Reassign table
// Tier I commit 1 — added party-too-large 409 with structured body
// + { force: true } bypass. SPEC §8.2: "A party of 10 cannot be
// assigned to a table of 7 (unless staff taps override)." The check
// considers the effective seat count: if the target table is part of
// an active merge that overlaps the reservation's time window, the
// summed group seat count is used instead of the single-table count.
router.put(
  '/reservations/:id/assign-table',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('tableId').isUUID(),
    body('force').optional().isBoolean(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;
      const { tableId, force } = req.body;

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
        select: { status: true, tableNumber: true, seatCount: true },
      });
      if (!targetTable) {
        return res.status(404).json({ error: 'Table not found' });
      }
      if (targetTable.status === 'OCCUPIED' || targetTable.status === 'OUT_OF_SERVICE') {
        return res.status(409).json({
          error: `Cannot assign: table ${targetTable.tableNumber} is ${targetTable.status === 'OCCUPIED' ? 'occupied' : 'out of service'}.`,
        });
      }

      // Tier I — effective seat count. If this table is in an active
      // merge overlapping the reservation's window, the group's summed
      // seat count is the right ceiling. Otherwise the single-table
      // seatCount.
      const merge = await findActiveMergeForTable(
        prisma,
        tableId,
        reservation.date,
        reservation.time,
        reservation.endTime
      );
      const effectiveSeats = merge ? merge.summedSeatCount : targetTable.seatCount;
      const effectiveLabel = merge ? merge.combinedLabel : targetTable.tableNumber;

      // SPEC §8.2 — party-too-large guard. Bypass with { force: true }.
      if (!force && reservation.partySize > effectiveSeats) {
        return res.status(409).json({
          error: {
            code: 'party-too-large',
            message: `Party of ${reservation.partySize} doesn't fit ${effectiveLabel} (${effectiveSeats} seat${effectiveSeats === 1 ? '' : 's'}). Pass { force: true } to override.`,
            tableId,
            tableLabel: effectiveLabel,
            seatCount: effectiveSeats,
            partySize: reservation.partySize,
            mergeGroupId: merge?.groupId || null,
          },
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

      const io = req.app.get('io');
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);

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

      // Tier I commit 1 (decision 2) — cancel auto-deactivates the
      // merge bound to this reservation. Pre-merges with no
      // reservationId stay until end-of-day cleanup.
      const { deactivatedGroups } = await deactivateMergesForReservation(prisma, id);

      const io = req.app.get('io');
      if (updated.userId) {
        dispatchAsync(prisma, io, {
          event: EVENTS.RESERVATION_CANCELLED_BY_RESTAURANT,
          userId: updated.userId,
          restaurantId,
          date: updated.date,
          time: updated.time,
        });
      }
      const cancelPayload = { ...updated, cancelledBy: 'restaurant' };
      io.emitToRestaurant(restaurantId, 'reservation:cancelled', cancelPayload);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:cancelled', cancelPayload);
      // Surface auto-deactivated merges so subscribers re-render.
      for (const groupId of deactivatedGroups) {
        io.emitToRestaurant(restaurantId, 'table:unmerged', { groupId, deactivated: 1, reason: 'reservation-cancelled' });
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
    // SPEC §3.1: guest phone required + must be +40 format. `.bail()` so a
    // missing phone reports "required", not the format error.
    body('guestPhone').notEmpty().withMessage('Guest phone is required').bail()
      .trim().matches(ROMANIAN_PHONE_RE).withMessage(PHONE_FORMAT_MSG),
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

      const io = req.app.get('io');
      io.emitToRestaurant(restaurantId, 'reservation:created', reservation);

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
      const io = req.app.get('io');
      if (updated.tableId) {
        const tableNow = new Date();
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: {
            status: 'OCCUPIED',
            statusChangedAt: tableNow,
          },
        });
        io.emitToRestaurant(restaurantId, 'table:status-changed', {
          tableId: updated.tableId,
          newStatus: 'OCCUPIED',
          statusChangedAt: tableNow,
        });
      }
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);

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

      // Tier I commit 1 (decision 2) — auto-deactivate the merge
      // bound to this reservation on completion.
      const { deactivatedGroups } = await deactivateMergesForReservation(prisma, id);

      const io = req.app.get('io');
      if (updated.tableId) {
        const tableNow = new Date();
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: {
            status: 'FREE',
            statusChangedAt: tableNow,
          },
        });
        io.emitToRestaurant(restaurantId, 'table:status-changed', {
          tableId: updated.tableId,
          newStatus: 'FREE',
          statusChangedAt: tableNow,
        });
      }
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);
      for (const groupId of deactivatedGroups) {
        io.emitToRestaurant(restaurantId, 'table:unmerged', { groupId, deactivated: 1, reason: 'reservation-completed' });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/no-show - Mark as no-show. C6 P3-5: captures the
// table's prior status (typically AWAITING_GUEST) in
// `noShowPriorTableStatus` so the restore-no-show endpoint can put the
// table back without guessing if the waiter taps Undo within the 10s
// toast grace.
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

      let priorTableStatus = null;
      let tableLabel = null;
      if (reservation.tableId) {
        const prevTable = await prisma.restaurantTable.findUnique({
          where: { id: reservation.tableId },
          select: { status: true, tableNumber: true },
        });
        priorTableStatus = prevTable?.status || null;
        tableLabel = prevTable?.tableNumber || null;
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: 'NO_SHOW',
          // Capture both for the undo path. ReservationStatus and table
          // status are unrelated enums (e.g. reservation=CONFIRMED while
          // table=AWAITING_GUEST), so each gets its own column.
          noShowPriorStatus: reservation.status,
          noShowPriorTableStatus: priorTableStatus,
        },
      });

      // Tier I commit 1 (decision 2) — auto-deactivate the merge
      // bound to this reservation on no-show.
      const { deactivatedGroups } = await deactivateMergesForReservation(prisma, id);

      const io = req.app.get('io');
      if (updated.tableId) {
        const tableNow = new Date();
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: {
            status: 'FREE',
            statusChangedAt: tableNow,
          },
        });
        io.emitToRestaurant(restaurantId, 'table:status-changed', {
          tableId: updated.tableId,
          newStatus: 'FREE',
          statusChangedAt: tableNow,
        });
      }
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);
      for (const groupId of deactivatedGroups) {
        io.emitToRestaurant(restaurantId, 'table:unmerged', { groupId, deactivated: 1, reason: 'reservation-no-show' });
      }

      // Include tableLabel in the response so the client can render it in
      // the undo toast without an extra round-trip if the popup didn't
      // already have it.
      res.json({ ...updated, tableLabel });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id/restore-no-show — C6 P3-5 undo path for the
// §3.5 toast. Reverts a recently-marked NoShow back to AwaitingGuest
// AND restores the table to its captured `noShowPriorTableStatus`.
// Race-safe: if the table has been claimed by another flow (e.g., a
// walk-in seated in the 10s undo grace window), responds 409 with
// { error: 'table-no-longer-free', tableLabel } so the caller can
// surface the specific copy.
router.put(
  '/reservations/:id/restore-no-show',
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
      });
      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }
      if (reservation.status !== 'NO_SHOW') {
        return res.status(409).json({ error: 'reservation-not-no-show' });
      }

      // Race check: the table must still be FREE for the restore to be
      // safe. If a walk-in took it during the grace window, bail with
      // a labeled 409.
      let tableLabel = null;
      if (reservation.tableId) {
        const currentTable = await prisma.restaurantTable.findUnique({
          where: { id: reservation.tableId },
          select: { status: true, tableNumber: true },
        });
        if (currentTable) {
          tableLabel = currentTable.tableNumber;
          if (currentTable.status !== 'FREE') {
            return res.status(409).json({
              error: 'table-no-longer-free',
              tableLabel,
            });
          }
        }
      }

      // Default reservation status: CONFIRMED (safe fallback if the
      // capture column is null for a legacy/pre-P3-5 no-show row).
      const priorReservationStatus = reservation.noShowPriorStatus || 'CONFIRMED';
      // Default table status: AWAITING_GUEST (the typical pre-no-show
      // state per §8.1).
      const priorTableStatus = reservation.noShowPriorTableStatus || 'AWAITING_GUEST';
      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: priorReservationStatus,
          noShowPriorStatus: null,
          noShowPriorTableStatus: null,
        },
      });

      const io = req.app.get('io');
      if (updated.tableId) {
        const tableNow = new Date();
        await prisma.restaurantTable.update({
          where: { id: updated.tableId },
          data: { status: priorTableStatus, statusChangedAt: tableNow },
        });
        io.emitToRestaurant(restaurantId, 'table:status-changed', {
          tableId: updated.tableId,
          newStatus: priorTableStatus,
          statusChangedAt: tableNow,
        });
      }
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);

      res.json({ ...updated, tableLabel });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /reservations/:id — generic staff edit (C6 Phase 1).
// Used by §3.9 edit-from-popup flow. Allows time/date/party/phone/special
// requests changes. Conflict + opening-hours validation deferred to the
// caller for MVP — staff-initiated edits are trusted per SPEC §9.5 (same
// trust model as staff-created reservations). Emits reservation:updated.
//
// Optimized to hit the budget: when `time` isn't changing we skip the
// restaurant lookup; the existence + ownership check is collapsed into
// the update path via `updateMany`. Typical edit (specialRequests only)
// is 2 Railway round-trips: updateMany + final findUnique with includes.
router.put(
  '/reservations/:id',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('date').optional().isISO8601(),
    body('time').optional().matches(/^\d{2}:\d{2}$/),
    body('partySize').optional().isInt({ min: 1 }),
    // SPEC §3.1: when staff edits the guest phone it must be +40 format.
    body('guestPhone').optional({ checkFalsy: true }).trim().matches(ROMANIAN_PHONE_RE).withMessage(PHONE_FORMAT_MSG),
    body('guestName').optional().trim(),
    body('specialRequests').optional({ nullable: true }).isString(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { id } = req.params;
      const { date, time, partySize, guestPhone, guestName, specialRequests } = req.body;

      const updateData = {};
      if (date !== undefined) updateData.date = new Date(date);
      if (partySize !== undefined) updateData.partySize = parseInt(partySize);
      if (guestPhone !== undefined) updateData.guestPhone = guestPhone;
      if (guestName !== undefined) updateData.guestName = guestName;
      if (specialRequests !== undefined) updateData.specialRequests = specialRequests || null;
      if (time !== undefined) {
        updateData.time = time;
        const restaurant = await prisma.restaurant.findUnique({
          where: { id: restaurantId },
          select: { reservationDurationMin: true },
        });
        const duration = restaurant?.reservationDurationMin || 120;
        updateData.endTime = addMinutes(time, duration);
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      // C6 P3-6: conflict check per §4.1 — when time/date changes on a
      // tabled reservation, the new slot must not overlap another active
      // booking on the same table. (Phase 1's "trust model" comment was
      // pragmatic but §4.1 mandates a check; P3-6 adds it.) Skipped when
      // tableId is null (the edit doesn't put anyone onto a table) or
      // when neither time nor date changed.
      if (
        (updateData.time !== undefined || updateData.date !== undefined) &&
        // Need to know the reservation's current tableId. Fetch only when
        // we might conflict so the common no-table-change path stays cheap.
        true
      ) {
        const current = await prisma.reservation.findFirst({
          where: { id, restaurantId },
          select: { tableId: true, time: true, endTime: true, date: true },
        });
        if (!current) {
          return res.status(404).json({ error: 'Reservation not found' });
        }
        if (current.tableId) {
          const checkDate = updateData.date || current.date;
          const checkTime = updateData.time || current.time;
          const checkEndTime = updateData.endTime || current.endTime;
          const overlap = await prisma.reservation.findFirst({
            where: {
              restaurantId,
              tableId: current.tableId,
              date: checkDate,
              id: { not: id },
              status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
              AND: [
                { time: { lt: checkEndTime } },
                { endTime: { gt: checkTime } },
              ],
            },
            select: { id: true, time: true },
          });
          if (overlap) {
            const tableRow = await prisma.restaurantTable.findUnique({
              where: { id: current.tableId },
              select: { tableNumber: true },
            });
            return res.status(409).json({
              error: 'table-conflict',
              tableLabel: tableRow?.tableNumber || null,
              conflictTime: overlap.time,
            });
          }
        }
      }

      const result = await prisma.reservation.updateMany({
        where: { id, restaurantId },
        data: updateData,
      });
      if (result.count === 0) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      const updated = await prisma.reservation.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          restaurantId: true,
          tableId: true,
          date: true,
          time: true,
          endTime: true,
          partySize: true,
          status: true,
          source: true,
          specialRequests: true,
          guestName: true,
          guestPhone: true,
          guestEmail: true,
          seatedAt: true,
          actualPartySize: true,
          table: { select: { id: true, tableNumber: true, seatCount: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      const io = req.app.get('io');
      io.emitToRestaurant(restaurantId, 'reservation:updated', updated);
      if (updated.userId) io.emitToUser(updated.userId, 'reservation:updated', updated);

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

      // Tier E commit 1: wrap both writes in $transaction so a crash
      // between them can't leave APPROVED stamped on the modification
      // while the reservation row is still on the old values.
      const [reservationAfter, updated] = await prisma.$transaction([
        prisma.reservation.update({
          where: { id: modification.reservationId },
          data: updateData,
        }),
        prisma.reservationModification.update({
          where: { id },
          data: {
            status: 'APPROVED',
            resolvedAt: new Date(),
          },
        }),
      ]);

      const io = req.app.get('io');
      if (reservationAfter.userId) {
        dispatchAsync(prisma, io, {
          event: EVENTS.MODIFICATION_APPROVED,
          userId: reservationAfter.userId,
          restaurantId,
          date: reservationAfter.date,
          time: reservationAfter.time,
          partySize: reservationAfter.partySize,
        });
      }
      io.emitToRestaurant(restaurantId, 'reservation:updated', reservationAfter);
      if (reservationAfter.userId) io.emitToUser(reservationAfter.userId, 'reservation:updated', reservationAfter);

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

      const io = req.app.get('io');
      if (modification.reservation && modification.reservation.userId) {
        dispatchAsync(prisma, io, {
          event: EVENTS.MODIFICATION_REJECTED,
          userId: modification.reservation.userId,
          restaurantId,
          date: modification.reservation.date,
          time: modification.reservation.time,
        });
      }
      const modPayload = {
        id: modification.reservation?.id,
        restaurantId,
        userId: modification.reservation?.userId,
        modificationPending: null,
        modificationRejected: { id: updated.id, resolvedAt: updated.resolvedAt },
      };
      io.emitToRestaurant(restaurantId, 'reservation:updated', modPayload);
      if (modPayload.userId) io.emitToUser(modPayload.userId, 'reservation:updated', modPayload);

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

// GET /layout/:sectionId - Get specific section with tables.
// The literal "/layout/live" is handled by a separate route declared later
// in this file. The validator allows it through (sectionId === 'live') and
// the handler delegates via next('route') so Express continues matching.
router.get(
  '/layout/:sectionId',
  authenticateRestaurant,
  [param('sectionId').custom((v) => v === 'live' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)).withMessage('Invalid section id')],
  handleValidationErrors,
  async (req, res, next) => {
    if (req.params.sectionId === 'live') return next('route');
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

      const previous = await prisma.restaurantTable.findUnique({
        where: { id },
        select: { status: true, restaurantId: true },
      });

      const tableNow = new Date();
      const updated = await prisma.restaurantTable.update({
        where: { id },
        data: {
          status,
          statusChangedAt: tableNow,
        },
      });

      const io = req.app.get('io');
      io.emitToRestaurant(updated.restaurantId, 'table:status-changed', {
        tableId: updated.id,
        newStatus: updated.status,
        statusChangedAt: updated.statusChangedAt,
      });
      // Heuristic walk-in lifecycle signal: any explicit OCCUPIED→FREE flip at
      // this generic endpoint represents a walk-in being cleared (the
      // reservation /complete and /no-show paths free the table via Prisma
      // directly, not via this route, so we don't double-fire). Close the
      // open TableActivity row if one exists so the calendar (§6.4) shows
      // the walk-in's actual duration rather than +120min.
      if (previous?.status === 'OCCUPIED' && status === 'FREE') {
        const openWalkin = await prisma.tableActivity.findFirst({
          where: { tableId: id, kind: 'WALK_IN', endedAt: null },
          orderBy: { startedAt: 'desc' },
        });
        if (openWalkin) {
          await prisma.tableActivity.update({
            where: { id: openWalkin.id },
            data: { endedAt: tableNow },
          });
        }
        io.emitToRestaurant(updated.restaurantId, 'walkin:ended', {
          tableId: updated.id,
          activityId: openWalkin?.id || null,
          endedAt: tableNow,
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /tables/:id/seat - Mark table as taken for walk-in. C6 P3-4 added
// optional walkInName (stored on TableActivity.notes) so the calendar
// view and live overlay can show a label for the walk-in party.
//
// SPEC §8.1 override: backend accepts any guestCount >= 1 even if it
// exceeds the table's seatCount — the staff has the override per §8.2.
// The UI warns before allowing it; the backend trusts the click.
router.put(
  '/tables/:id/seat',
  authenticateRestaurant,
  [
    param('id').isUUID(),
    body('guestCount').isInt({ min: 1 }),
    body('walkInName').optional({ nullable: true }).isString().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;
      const { guestCount, walkInName } = req.body;

      const tableNow = new Date();
      const todayBuch = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
      const nowHm = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const todayObj = new Date(`${todayBuch}T00:00:00.000Z`);

      // Tier I commit 1 (decision 6) — when the seated table is part of
      // an active merge, the WHOLE merge group flips to OCCUPIED. Same
      // walk-in activity row is written for the table the staff tapped
      // (the merge target). Callers don't need to know about group ids;
      // any member tableId resolves transparently.
      const merge = await findActiveMergeForTable(prisma, id, todayObj, nowHm, nowHm);
      const idsToFlip = merge ? merge.members.map((m) => m.id) : [id];

      const restaurant = await prisma.restaurantTable.findUnique({
        where: { id }, select: { restaurantId: true },
      });

      // Atomically flip every member to OCCUPIED + write the single
      // walk-in activity row. Single transaction so a partial flip
      // can't leave the merge in a half-occupied limbo.
      const ops = [
        prisma.restaurantTable.updateMany({
          where: { id: { in: idsToFlip } },
          data: { status: 'OCCUPIED', statusChangedAt: tableNow },
        }),
        prisma.tableActivity.create({
          data: {
            tableId: id,
            restaurantId: restaurant.restaurantId,
            kind: 'WALK_IN',
            date: todayObj,
            startedAt: tableNow,
            partySize: parseInt(guestCount),
            notes: walkInName ? walkInName.trim() : null,
          },
        }),
      ];
      const [, activity] = await prisma.$transaction(ops);

      const io = req.app.get('io');
      io.emitToRestaurant(restaurant.restaurantId, 'walkin:created', {
        tableId: id,
        activityId: activity.id,
        partySize: parseInt(guestCount),
        walkInName: walkInName || null,
        startedAt: tableNow,
        // Surface the group context to subscribers so a merged-table
        // walk-in renders correctly even before the next /layout/live
        // refresh.
        mergeGroupId: merge?.groupId || null,
        mergedTableIds: merge ? merge.members.map((m) => m.id) : null,
      });
      // Emit one table:status-changed per flipped member so existing
      // C4 subscribers (live page, calendar) patch each cell in place.
      for (const flippedId of idsToFlip) {
        io.emitToRestaurant(restaurant.restaurantId, 'table:status-changed', {
          tableId: flippedId,
          newStatus: 'OCCUPIED',
          statusChangedAt: tableNow,
        });
      }

      // Return the originally-tapped table row for backward compat.
      const updated = await prisma.restaurantTable.findUnique({ where: { id } });
      res.json({ ...updated, activityId: activity.id, mergeGroupId: merge?.groupId || null });
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

// ============================================
// TABLE MERGING (Tier I commit 1, SPEC §8.2)
//
// POST /tables/merge
// Body: {
//   tableIds: [id1, id2, ...],   // 2-4 members, all adjacent, same restaurant
//   date: 'YYYY-MM-DD',
//   timeStart: 'HH:mm',
//   timeEnd:   'HH:mm',
//   reservationId?: uuid          // optional — see decisions log #1 (hybrid scope)
// }
// Returns 201 with the materialized merge group object (groupId,
// members, summedSeatCount, combinedLabel, …) AND emits table:merged
// to the restaurant room. Structured 400/409s on every guard failure
// per the Tier I plan.
// ============================================
router.post(
  '/tables/merge',
  authenticateRestaurant,
  [
    body('tableIds').isArray({ min: 2 }).withMessage('tableIds must be an array of at least 2 UUIDs'),
    body('tableIds.*').isUUID(),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/),
    body('timeStart').matches(/^\d{2}:\d{2}$/),
    body('timeEnd').matches(/^\d{2}:\d{2}$/),
    body('reservationId').optional({ nullable: true }).isUUID(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { tableIds, date, timeStart, timeEnd, reservationId } = req.body;

      // 1) Cap check up front so we don't pay for adjacency math on a
      //    5-table request that's bound to fail anyway.
      const uniqueIds = [...new Set(tableIds)];
      if (uniqueIds.length < MIN_MERGE_MEMBERS) {
        return res.status(400).json({
          error: { code: 'merge-too-small', message: `Need at least ${MIN_MERGE_MEMBERS} distinct tables to merge.` },
        });
      }
      if (uniqueIds.length > MAX_MERGE_MEMBERS) {
        return res.status(400).json({
          error: {
            code: 'merge-cap-exceeded',
            message: `Maximum ${MAX_MERGE_MEMBERS} tables can be merged.`,
            requested: uniqueIds.length,
            cap: MAX_MERGE_MEMBERS,
          },
        });
      }

      // 2) Time-window sanity. End-exclusive convention per §9.2.
      if (timeRangesOverlap(timeStart, timeEnd, timeEnd, timeEnd)) {
        // overlap-with-self trick: triggers only when start>=end
        // ((start < end) is false), since end<end is also false.
        // We need start<end strictly.
      }
      // Direct comparison reads cleaner than the overlap-with-self hack:
      const startMin = parseInt(timeStart.split(':')[0]) * 60 + parseInt(timeStart.split(':')[1]);
      const endMin = parseInt(timeEnd.split(':')[0]) * 60 + parseInt(timeEnd.split(':')[1]);
      if (startMin >= endMin) {
        return res.status(400).json({
          error: { code: 'invalid-time-window', message: 'timeStart must be before timeEnd.' },
        });
      }

      // 3) Load + scope-check all member tables. Reject if any belongs
      //    to a different restaurant (defense vs. malicious cross-tenant ids).
      const members = await prisma.restaurantTable.findMany({
        where: { id: { in: uniqueIds }, restaurantId, isActive: true },
        select: { id: true, tableNumber: true, seatCount: true, gridRow: true, gridCol: true, sectionId: true, status: true },
      });
      if (members.length !== uniqueIds.length) {
        return res.status(404).json({
          error: { code: 'tables-not-found', message: 'One or more tables do not belong to this restaurant.' },
        });
      }

      // 4) All members in the same section. SPEC §8.2 is silent on cross-
      //    section merges, but the grid coordinate system is per-section,
      //    so a cross-section adjacency check would be meaningless.
      const sectionIds = [...new Set(members.map((m) => m.sectionId))];
      if (sectionIds.length > 1) {
        return res.status(400).json({
          error: { code: 'cross-section-merge', message: 'All merged tables must be in the same section.' },
        });
      }

      // 5) Adjacency: every member reachable from any other via Manhattan-1.
      if (!isConnectedByAdjacency(members)) {
        return res.status(400).json({
          error: {
            code: 'not-adjacent',
            message: 'All merged tables must be directly adjacent (up/down/left/right — not diagonal).',
            members: members.map((m) => ({ id: m.id, tableNumber: m.tableNumber, gridRow: m.gridRow, gridCol: m.gridCol })),
          },
        });
      }

      // 6) Status check: no member is currently OCCUPIED (decision 3).
      //    OUT_OF_SERVICE also blocked — you wouldn't merge with an
      //    out-of-service table.
      const blocked = members.filter((m) => m.status === 'OCCUPIED' || m.status === 'OUT_OF_SERVICE');
      if (blocked.length > 0) {
        return res.status(409).json({
          error: {
            code: 'member-not-mergeable',
            message: `Cannot merge: ${blocked.map((b) => `${b.tableNumber} is ${b.status}`).join(', ')}.`,
            blocked: blocked.map((b) => ({ id: b.id, tableNumber: b.tableNumber, status: b.status })),
          },
        });
      }

      // 7) Time-window conflict with existing active merges. Pull every
      //    active merge row for the date that overlaps any of our member
      //    tableIds. Reject if any belongs to a DIFFERENT merge group
      //    whose window overlaps ours.
      const dateObj = new Date(`${date}T00:00:00.000Z`);
      const conflictingMoves = await prisma.tableMove.findMany({
        where: {
          isActive: true,
          date: dateObj,
          tableId: { in: uniqueIds },
          mergeGroupId: { not: null },
        },
        select: { tableId: true, mergeGroupId: true, timeStart: true, timeEnd: true, table: { select: { tableNumber: true } } },
      });
      const overlapping = conflictingMoves.filter((m) =>
        timeRangesOverlap(timeStart, timeEnd, m.timeStart, m.timeEnd)
      );
      if (overlapping.length > 0) {
        return res.status(409).json({
          error: {
            code: 'merge-window-conflict',
            message: `Some tables are already in another active merge during this window.`,
            conflicts: overlapping.map((o) => ({
              tableId: o.tableId,
              tableNumber: o.table?.tableNumber,
              groupId: o.mergeGroupId,
              timeStart: o.timeStart,
              timeEnd: o.timeEnd,
            })),
          },
        });
      }

      // 8) Reservation conflict: another reservation (not the bound one)
      //    overlapping the requested window on any member. Mirrors the
      //    spec's "Reservation logic" intent — you can't merge tables
      //    that are already booked by someone else in that window.
      const otherReservations = await prisma.reservation.findMany({
        where: {
          tableId: { in: uniqueIds },
          date: dateObj,
          status: { in: ['CONFIRMED', 'AUTO_CONFIRMED', 'PENDING'] },
          ...(reservationId ? { NOT: { id: reservationId } } : {}),
        },
        select: { id: true, tableId: true, time: true, endTime: true, partySize: true, guestName: true },
      });
      const reservationConflicts = otherReservations.filter((r) =>
        timeRangesOverlap(timeStart, timeEnd, r.time, r.endTime)
      );
      if (reservationConflicts.length > 0) {
        return res.status(409).json({
          error: {
            code: 'reservation-conflict',
            message: `Some tables have other reservations during this window.`,
            conflicts: reservationConflicts.map((r) => ({
              reservationId: r.id,
              tableId: r.tableId,
              time: r.time,
              endTime: r.endTime,
              partySize: r.partySize,
            })),
          },
        });
      }

      // 9) All checks passed — create one TableMove row per member with
      //    a shared mergeGroupId. The original cell is captured from the
      //    table's current (unmerged) coordinates; the moved cell is the
      //    same since we don't physically displace the underlying row
      //    (RestaurantTable @@unique([sectionId, gridRow, gridCol])
      //    blocks shared coordinates).
      const groupId = crypto.randomUUID();
      await prisma.$transaction(
        members.map((m) =>
          prisma.tableMove.create({
            data: {
              tableId: m.id,
              reservationId: reservationId || null,
              originalGridRow: m.gridRow,
              originalGridCol: m.gridCol,
              movedGridRow: m.gridRow, // unchanged; merge is a virtual grouping
              movedGridCol: m.gridCol,
              mergeGroupId: groupId,
              date: dateObj,
              timeStart,
              timeEnd,
              isActive: true,
            },
          })
        )
      );

      const group = await loadMergeGroup(prisma, groupId);

      const io = req.app.get('io');
      io.emitToRestaurant(restaurantId, 'table:merged', group);

      res.status(201).json(group);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /merges/:groupId/unmerge — atomically deactivate every member of
// the merge group and emit table:unmerged.
router.put(
  '/merges/:groupId/unmerge',
  authenticateRestaurant,
  [param('groupId').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { groupId } = req.params;

      // Scope-check via join: ensure the group's rows belong to tables
      // in this restaurant (defense vs. cross-tenant unmerge attempts).
      const rows = await prisma.tableMove.findMany({
        where: { mergeGroupId: groupId, table: { restaurantId } },
        select: { id: true, isActive: true, tableId: true },
      });
      if (rows.length === 0) {
        return res.status(404).json({
          error: { code: 'merge-group-not-found', message: 'Merge group not found for this restaurant.' },
        });
      }

      const activeIds = rows.filter((r) => r.isActive).map((r) => r.id);
      if (activeIds.length === 0) {
        // Idempotent: a second unmerge on an already-deactivated group
        // is a no-op rather than an error.
        return res.json({ message: 'Merge group already deactivated.', groupId, deactivated: 0 });
      }

      await prisma.tableMove.updateMany({
        where: { id: { in: activeIds } },
        data: { isActive: false },
      });

      const io = req.app.get('io');
      io.emitToRestaurant(restaurantId, 'table:unmerged', {
        groupId,
        tableIds: rows.map((r) => r.tableId),
        deactivated: activeIds.length,
      });

      res.json({ message: 'Merge group deactivated.', groupId, deactivated: activeIds.length });
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

// GET /layout/live - Get current LIVE data.
// C6 Phase 1: each table object now carries `currentReservation` and
// `nextReservation` so the floor-plan overlay (§3.7) can render guest
// name + party + time without a second round-trip, and a `secondsLate`
// field powers the late-arrival display (§3.13). Pre-existing
// `occupancyDurationMin` and `hasAlert` fields are preserved.
router.get('/layout/live', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;
    const now = new Date();
    const todayBuch = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    const nowHm = now.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const tables = await prisma.restaurantTable.findMany({
      where: {
        restaurantId,
        isActive: true,
      },
      include: {
        reservations: {
          where: {
            date: new Date(`${todayBuch}T00:00:00.000Z`),
            status: { in: ['CONFIRMED', 'AUTO_CONFIRMED', 'PENDING'] },
          },
          select: {
            id: true,
            time: true,
            endTime: true,
            partySize: true,
            status: true,
            specialRequests: true,
            seatedAt: true,
            guestName: true,
            user: { select: { firstName: true, lastName: true } },
          },
          orderBy: { time: 'asc' },
        },
      },
    });

    // Tier I commit 1 — attach the merge sub-object on tables that
    // belong to an active merge group whose window covers "now". The
    // mapper is async so it runs once outside the table loop.
    const mergeMap = await activeMergeMapForRestaurant(
      prisma,
      restaurantId,
      new Date(`${todayBuch}T00:00:00.000Z`),
      nowHm
    );

    const tablesWithStatus = tables.map((table) => {
      let occupancyDurationMin = null;
      let hasAlert = false;

      if (table.status === 'OCCUPIED' && table.statusChangedAt) {
        const minutes = Math.floor((now.getTime() - table.statusChangedAt.getTime()) / (1000 * 60));
        occupancyDurationMin = minutes;
        if (minutes > 120) hasAlert = true;
      }

      // C6 post-QA fix-the-fix: the popup's actionsForStatus needs
      // status + tableId + seatedAt to derive the AwaitingGuest action
      // set when reservation.status === CONFIRMED / AUTO_CONFIRMED and
      // the table has flipped to AWAITING_GUEST. Without these fields
      // the popup falls back to switch's default → "No actions
      // available" regression on /dashboard/live.
      const summarize = (r) => r && {
        id: r.id,
        guestName: r.guestName || [r.user?.firstName, r.user?.lastName].filter(Boolean).join(' ') || null,
        partySize: r.partySize,
        time: r.time,
        status: r.status,
        tableId: r.tableId || null,
        seatedAt: r.seatedAt,
        hasSpecialRequests: !!(r.specialRequests && r.specialRequests.trim()),
      };

      // currentReservation: the one whose time window covers now-ish, or the
      // one tied to the seated guest. Pick the reservation that's seated (if
      // any) — that's authoritative — otherwise the earliest one whose
      // window contains nowHm.
      let current = null;
      let next = null;
      for (const r of table.reservations) {
        if (r.seatedAt && !current) current = r;
        if (!current && r.time <= nowHm && nowHm < r.endTime) current = r;
        if (!next && r.time > nowHm) next = r;
      }

      // secondsLate: reservation is "late" when it's past its start time but
      // the guest hasn't been seated yet AND the table is in Awaiting Guest.
      // Negative or missing means not late.
      let secondsLate = null;
      const lateRef = current || table.reservations.find(r => !r.seatedAt && r.time <= nowHm);
      if (lateRef && !lateRef.seatedAt && lateRef.time <= nowHm) {
        const [rh, rm] = lateRef.time.split(':').map(Number);
        const [nh, nm] = nowHm.split(':').map(Number);
        secondsLate = ((nh * 60 + nm) - (rh * 60 + rm)) * 60;
        if (secondsLate < 0) secondsLate = null;
      }

      return {
        ...table,
        occupancyDurationMin,
        hasAlert,
        currentReservation: summarize(current),
        nextReservation: summarize(next),
        secondsLate,
        // Tier I commit 1 — null when the table is standalone; the
        // current Live UI ignores unknown fields so this is purely
        // additive (no I1 visual change).
        merge: mergeMap.get(table.id) || null,
      };
    });

    res.json(tablesWithStatus);
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/summary — new in C6 Phase 1.
// Powers the rebuilt Dashboard (§3.8): NOW / NEXT / counts in a single
// round-trip. Tablet-friendly p95 target <500ms.
router.get('/dashboard/summary', authenticateRestaurant, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;
    const now = new Date();
    const todayBuch = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    const nowHm = now.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const todayStart = new Date(`${todayBuch}T00:00:00.000Z`);

    // Single fetch for today's reservations + table label + guest name.
    const todays = await prisma.reservation.findMany({
      where: {
        restaurantId,
        date: todayStart,
        status: { in: ['CONFIRMED', 'AUTO_CONFIRMED', 'PENDING'] },
      },
      select: {
        id: true,
        tableId: true, // C6 post-QA fix-the-fix — needed by isAwaitingGuestDerived
        time: true,
        endTime: true,
        partySize: true,
        status: true,
        specialRequests: true,
        seatedAt: true,
        guestName: true,
        user: { select: { firstName: true, lastName: true } },
        table: { select: { tableNumber: true, status: true } },
      },
      orderBy: { time: 'asc' },
    });

    const shape = (r) => {
      const [rh, rm] = r.time.split(':').map(Number);
      const [nh, nm] = nowHm.split(':').map(Number);
      const minsLate = (nh * 60 + nm) - (rh * 60 + rm);
      let secondsLate = null;
      if (!r.seatedAt && minsLate > 0) secondsLate = minsLate * 60;
      // C6 post-QA fix-the-fix: include tableId + seatedAt so the
      // popup's isAwaitingGuestDerived helper has the fields it needs.
      // Pre-fix the Dashboard path silently failed condition 2 (tableId)
      // and 3 (seatedAt) even though secondsLate was correct.
      return {
        id: r.id,
        guestName: r.guestName || [r.user?.firstName, r.user?.lastName].filter(Boolean).join(' ') || null,
        partySize: r.partySize,
        time: r.time,
        status: r.status,
        tableId: r.tableId || null,
        seatedAt: r.seatedAt,
        // tableNumber already carries the "T" prefix (e.g. "T5") per
        // commit 5eabdc0; don't double-prepend in the summary payload.
        tableLabel: r.table ? r.table.tableNumber : null,
        hasSpecialRequests: !!(r.specialRequests && r.specialRequests.trim()),
        secondsLate,
      };
    };

    const activeReservations = [];
    const upcomingReservations = [];
    for (const r of todays) {
      const seated = !!r.seatedAt;
      const awaiting = r.table?.status === 'AWAITING_GUEST' && !seated;
      if (seated || awaiting) {
        activeReservations.push(shape(r));
      } else if (r.time >= nowHm && r.status !== 'PENDING') {
        if (upcomingReservations.length < 8) upcomingReservations.push(shape(r));
      }
    }

    const [pendingConfirmationCount, occupiedCount] = await Promise.all([
      prisma.reservation.count({ where: { restaurantId, status: 'PENDING' } }),
      prisma.restaurantTable.count({ where: { restaurantId, isActive: true, status: 'OCCUPIED' } }),
    ]);

    res.json({
      currentTime: nowHm,
      activeReservations,
      upcomingReservations,
      pendingConfirmationCount,
      todayCount: todays.length,
      occupiedCount,
    });
  } catch (error) {
    next(error);
  }
});

// GET /availability — new in C6 Phase 1.
// Powers the live availability hint under Quick Add (§3.3). Called on every
// keystroke (debounced 300ms client-side); p95 target <200ms.
router.get(
  '/availability',
  authenticateRestaurant,
  [
    query('date').isISO8601(),
    query('time').matches(/^\d{2}:\d{2}$/),
    query('partySize').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { date, time } = req.query;
      const pSize = parseInt(req.query.partySize);

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { reservationDurationMin: true },
      });
      const durationMin = restaurant?.reservationDurationMin || 120;
      const endTime = addMinutes(time, durationMin);

      // SPEC §8.1: skip tables currently Occupied/OutOfService even if no
      // future-time conflict — they aren't available to take the booking.
      const candidates = await prisma.restaurantTable.findMany({
        where: {
          restaurantId,
          isActive: true,
          seatCount: { gte: pSize },
          status: { notIn: ['OCCUPIED', 'OUT_OF_SERVICE'] },
        },
        select: { id: true, seatCount: true },
      });

      // Tier I commit 3 — promote suggestionForCombining from boolean
      // to a concrete list of merge candidates. The Quick Add UI can
      // then prompt staff to merge specific tables rather than just
      // "figure it out yourself." Computed by walking every adjacent
      // pair/triple/quad (up to MAX_MERGE_MEMBERS) of FREE tables in
      // the same section that haven't been booked in this window, then
      // ranking by free-neighbor count (more adjacencies = more
      // combining flexibility for the next reservation). Top 3 returned.
      const allActiveTables = await prisma.restaurantTable.findMany({
        where: {
          restaurantId,
          isActive: true,
          status: { notIn: ['OCCUPIED', 'OUT_OF_SERVICE'] },
        },
        select: { id: true, tableNumber: true, seatCount: true, gridRow: true, gridCol: true, sectionId: true },
      });

      if (candidates.length === 0) {
        // Even if no single table is ≥ pSize, suggest merges from the
        // wider candidate pool.
        const suggestions = await computeMergeSuggestions(prisma, restaurantId, allActiveTables, new Date(date), time, endTime, pSize);
        return res.json({
          exactMatchCount: 0,
          anyMatchCount: 0,
          suggestionForCombining: suggestions.length > 0,
          mergeSuggestions: suggestions,
        });
      }

      const conflicting = await prisma.reservation.findMany({
        where: {
          restaurantId,
          date: new Date(date),
          tableId: { in: candidates.map((t) => t.id) },
          status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
          AND: [
            { time: { lt: endTime } },
            { endTime: { gt: time } },
          ],
        },
        select: { tableId: true },
      });
      const conflictSet = new Set(conflicting.map((c) => c.tableId));

      const free = candidates.filter((t) => !conflictSet.has(t.id));
      const exactMatchCount = free.filter((t) => t.seatCount === pSize).length;
      const anyMatchCount = free.length;

      // Always compute merge candidates so the UI can show alternatives
      // even when an exact-match table exists (helps staff plan around
      // adjacent free runs that they'd rather keep for a larger party).
      const mergeSuggestions = await computeMergeSuggestions(prisma, restaurantId, allActiveTables, new Date(date), time, endTime, pSize);
      const suggestionForCombining = anyMatchCount === 0;

      res.json({ exactMatchCount, anyMatchCount, suggestionForCombining, mergeSuggestions });
    } catch (error) {
      next(error);
    }
  }
);

// computeMergeSuggestions (the adjacent-table merge enumerator used by
// the Quick-Add /availability endpoint above) was moved to
// lib/tableMerges.js in Tier G commit 5b — see the import at the top of
// this file. It is shared with the diner-facing GET /restaurants
// availability join so the merge-feasibility BFS lives in one place.

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
        photos: { orderBy: { displayOrder: 'asc' } },
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

// PUT /settings — comprehensive restaurant self-service profile + settings
// update (SPEC §6.7). restaurantId is ALWAYS derived from the JWT, never
// a path/body parameter, so staff can only ever edit their own restaurant.
// Strict field whitelist: anything outside it (including a forged
// `restaurantId`) is rejected with 400 unknown-field rather than silently
// ignored. Returns the GET /profile shape so the client can patch in place.
const SETTINGS_ALLOWED_FIELDS = new Set([
  'autoConfirmEnabled', 'descriptionRo', 'descriptionEn',
  'phone', 'email', 'website', 'openingHours', 'servicePeriods',
]);
router.put(
  '/settings',
  authenticateRestaurant,
  (req, res, next) => {
    for (const key of Object.keys(req.body || {})) {
      if (!SETTINGS_ALLOWED_FIELDS.has(key)) {
        return res.status(400).json({
          error: { code: 'unknown-field', field: key, message: `Field not allowed: ${key}` },
        });
      }
    }
    next();
  },
  [
    body('autoConfirmEnabled').optional().isBoolean(),
    body('descriptionRo').optional().trim(),
    body('descriptionEn').optional().trim(),
    // SPEC §3.1 / §6.7: contact phone must be +40 format when provided.
    body('phone').optional({ checkFalsy: true }).trim().matches(ROMANIAN_PHONE_RE).withMessage(PHONE_FORMAT_MSG),
    body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Invalid email address'),
    body('website').optional({ checkFalsy: true }).trim()
      .isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Website must be a valid http(s) URL'),
    body('openingHours').optional().isArray(),
    body('servicePeriods').optional().isArray(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const { autoConfirmEnabled, descriptionRo, descriptionEn, phone, email, website, openingHours, servicePeriods } = req.body;

      const updateData = {};
      if (autoConfirmEnabled !== undefined) updateData.autoConfirmEnabled = autoConfirmEnabled;
      if (descriptionRo !== undefined) updateData.descriptionRo = descriptionRo;
      if (descriptionEn !== undefined) updateData.descriptionEn = descriptionEn;
      if (phone !== undefined) updateData.phone = phone;
      if (email !== undefined) updateData.email = email;
      if (website !== undefined) updateData.website = website;

      if (Object.keys(updateData).length > 0) {
        await prisma.restaurant.update({ where: { id: restaurantId }, data: updateData });
      }
      await applyOpeningHours(prisma, restaurantId, openingHours);
      await applyServicePeriods(prisma, restaurantId, servicePeriods);

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        include: {
          openingHours: { orderBy: { dayOfWeek: 'asc' } },
          servicePeriods: true,
          photos: { orderBy: { displayOrder: 'asc' } },
        },
      });
      res.json(restaurant);
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
