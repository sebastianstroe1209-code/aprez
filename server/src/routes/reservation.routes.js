const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');
const { EVENTS, dispatchAsync } = require('../services/notifications');
const { deactivateMergesForReservation, countFreeAdjacents } = require('../lib/tableMerges');
const { timeMinutesFitsOpenWindow } = require('../lib/openingHours');

const router = express.Router();

// Helper function to add minutes to time string HH:MM
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// timeMinutesFitsOpenWindow (cross-midnight-aware open-window check) was
// extracted to lib/openingHours.js in Tier G commit 5b so the diner
// GET /restaurants availability join shares the exact same math — see
// the import above. Both POST /reservations and the reservation-modify
// route still call it; behavior is unchanged.

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
    // §5.3 — optional diner free-text note; capped at 500 chars.
    body('specialRequests').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { restaurantId, date, time, partySize, specialRequests } = req.body;

      // K6 — reject past dates (Europe/Bucharest). The mobile picker
      // gates this client-side, but the API took past dates pre-K6 →
      // orphan rows with date='2025-01-01' from the audit. Defense
      // in depth per SPEC §5.3 (future-only). Structured code so the
      // client can localize.
      const todayBucharest = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
      const reqDateStr = String(date).slice(0, 10);
      if (reqDateStr < todayBucharest) {
        return res.status(400).json({ error: { code: 'date-in-past' } });
      }

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

      // Check time is within opening hours. Cross-midnight close
      // (e.g. closeTime='00:00' meaning 24:00) handled by the shared
      // helper above — pre-Tier-E this raw parser rejected late-night
      // slots at any restaurant that closes at midnight.
      if (!timeMinutesFitsOpenWindow(time, openingHour.openTime, openingHour.closeTime)) {
        return res.status(400).json({ error: `Reservations are only available between ${openingHour.openTime} and ${openingHour.closeTime}` });
      }
      const [reqH, reqM] = time.split(':').map(Number);
      const reqMin = reqH * 60 + reqM;

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
        select: { id: true, seatCount: true, sectionId: true, gridRow: true, gridCol: true },
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

      // Pick the table to (potentially) auto-confirm onto. SPEC §9.3:
      // among the exact-seat-match free tables, prefer the one with the
      // most free Manhattan-1 same-section neighbors (combining
      // flexibility). The tiebreak only matters when >1 exact match is
      // free; a single free candidate is picked unchanged.
      let freeTable = null;
      if (tables.length > 0) {
        // Conflicts across ALL tables in the window — needed both to
        // exclude busy candidates and to score the free-neighbor tiebreak.
        const conflicting = await prisma.reservation.findMany({
          where: {
            restaurantId,
            date: dateObj,
            status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
            tableId: { not: null },
            AND: [
              { time: { lt: endTime } },
              { endTime: { gt: time } },
            ],
          },
          select: { tableId: true },
        });

        const busyTableIds = new Set(conflicting.map((r) => r.tableId));
        const freeCandidates = tables.filter((t) => !busyTableIds.has(t.id));

        if (freeCandidates.length === 1) {
          freeTable = freeCandidates[0];
        } else if (freeCandidates.length > 1) {
          // Tiebreak: load the full grid once and rank by free-neighbor count.
          const gridTables = await prisma.restaurantTable.findMany({
            where: { restaurantId },
            select: { id: true, sectionId: true, gridRow: true, gridCol: true, status: true, isActive: true },
          });
          freeTable = freeCandidates
            .map((t) => ({ t, score: countFreeAdjacents(t, gridTables, busyTableIds) }))
            .sort((a, b) => b.score - a.score)[0].t;
        }
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

      // Create reservation. Include the user join so the §5a broadcast
      // payload (used by P3-2 pending-alert toast) carries a usable
      // guest name without the listener needing a follow-up fetch.
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
          // §5.3 — optional diner free-text note. Empty / whitespace → null.
          specialRequests: specialRequests && specialRequests.trim() ? specialRequests.trim() : null,
        },
        select: {
          id: true,
          userId: true,
          restaurantId: true,
          status: true,
          date: true,
          time: true,
          endTime: true,
          partySize: true,
          specialRequests: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true, phone: true } },
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
        // Tier E commit 2 — surface modification lifecycle on each row
        // so the mobile ReservationsScreen can render the inline reject
        // banner without a separate fetch. Reshaped below into the same
        // {modificationPending, modificationRejected} envelope the
        // restaurant-side list uses.
        modifications: {
          where: {
            OR: [
              { status: 'PENDING' },
              { status: 'REJECTED', acknowledgedAt: null },
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            requestedDate: true,
            requestedTime: true,
            requestedPartySize: true,
            status: true,
            resolvedAt: true,
            acknowledgedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });

    const shaped = reservations.map((r) => {
      const { modifications, ...rest } = r;
      const pending = (modifications || []).find((m) => m.status === 'PENDING') || null;
      const rejected = (modifications || []).find((m) => m.status === 'REJECTED' && !m.acknowledgedAt) || null;
      return { ...rest, modificationPending: pending, modificationRejected: rejected };
    });

    // J1d — canonical order for "my reservations": closest UPCOMING
    // first (date+time ascending), then PAST (most-recent first). A
    // single Prisma `orderBy` can't express the upcoming/past split, so
    // it's composed here — the mobile ReservationsScreen tabs inherit
    // this order directly. "Upcoming" = future-or-today date AND a
    // non-terminal status, matching the screen's own tab predicate.
    const TERMINAL = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    const dateStr = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
    const sortKey = (r) => `${dateStr(r.date)}T${r.time || ''}`;
    const isUpcoming = (r) => dateStr(r.date) >= todayStr && !TERMINAL.has(r.status);
    const upcoming = shaped.filter(isUpcoming).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const past = shaped.filter((r) => !isUpcoming(r)).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

    res.json({ reservations: [...upcoming, ...past] });
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
            // Tier E commit 2 — return only modifications that the
            // diner detail screen needs to render: the pending one (if
            // any) and the latest unacknowledged rejection. APPROVED
            // mods don't surface in UI; they're audit-only.
            where: {
              OR: [
                { status: 'PENDING' },
                { status: 'REJECTED', acknowledgedAt: null },
              ],
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              requestedDate: true,
              requestedTime: true,
              requestedPartySize: true,
              status: true,
              resolvedAt: true,
              acknowledgedAt: true,
              createdAt: true,
            },
          },
          specialRequests: true,
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // Reshape into the same envelope the /mine endpoint uses so the
      // mobile detail screen + the list share one parsing path.
      const { modifications, ...rest } = reservation;
      const pending = (modifications || []).find((m) => m.status === 'PENDING') || null;
      const rejected = (modifications || []).find((m) => m.status === 'REJECTED' && !m.acknowledgedAt) || null;

      res.json({ ...rest, modificationPending: pending, modificationRejected: rejected });
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

      // Tier I commit 1 — auto-deactivate any merge bound to this
      // reservation when the diner cancels (decision 2).
      const { deactivatedGroups } = await deactivateMergesForReservation(prisma, id);

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
      for (const groupId of deactivatedGroups) {
        io.emitToRestaurant(reservation.restaurantId, 'table:unmerged', { groupId, deactivated: 1, reason: 'reservation-cancelled' });
      }

      res.json(cancelled);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/modify - Request modification (SPEC §5.6)
//
// Hardening landed in Tier E commit 1:
//   1. reservation-not-modifiable — pre-Tier-E only CANCELLED was
//      blocked; COMPLETED + NO_SHOW slipped through and would have
//      created modifications against post-service rows.
//   2. modification-already-pending — spec is silent on outstanding-
//      modification uniqueness, but §5.6's "original stays active" model
//      assumes one decision at a time. 409 forces the diner to wait or
//      retract before stacking another.
//   3. no-op-modification — at least one requested field must be set AND
//      must differ from the current reservation value, otherwise the
//      staff popup would render an empty amber diff callout.
//
// Note (SPEC §5.6 / §9.3): modifications never re-trigger the auto-
// confirm rule set — they always require staff approval. The spec's
// "auto-confirmed → manual-review transition" is just describing this
// behavior, not a code path to build.
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

      // (1) Block post-service / terminated reservations.
      if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(reservation.status)) {
        return res.status(400).json({
          error: {
            code: 'reservation-not-modifiable',
            message: `Cannot modify a reservation with status ${reservation.status}.`,
          },
        });
      }

      // (3) Require at least one non-null requested field AND require it
      // to actually differ from the current value. Date comparison is
      // string-based against the YYYY-MM-DD slice to avoid TZ-driven
      // false negatives between the request body and the DB Date column.
      const reqDateIso = requestedDate ? new Date(requestedDate).toISOString().slice(0, 10) : null;
      const curDateIso = new Date(reservation.date).toISOString().slice(0, 10);
      const dateDiffers = reqDateIso !== null && reqDateIso !== curDateIso;
      const timeDiffers = requestedTime != null && requestedTime !== reservation.time;
      const partyDiffers = requestedPartySize != null && parseInt(requestedPartySize) !== reservation.partySize;
      if (!dateDiffers && !timeDiffers && !partyDiffers) {
        return res.status(400).json({
          error: {
            code: 'no-op-modification',
            message: 'Requested modification must change at least one of date/time/party size.',
          },
        });
      }

      // Tier E commit 2 — feasibility checks on the *effective* post-
      // modification state (requested fields fall back to the current
      // reservation values). Mirrors the same guards that POST
      // /reservations enforces so a diner can't sneak an unbookable
      // date/time through the modify path. All three return 400 with a
      // stable error.code so the mobile UI can surface localized copy.
      const effectiveDateIso = reqDateIso || curDateIso;
      const effectiveTime = requestedTime || reservation.time;

      // 3a) Effective date can't be in the past (Bucharest day).
      const todayBucharest = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
      if (effectiveDateIso < todayBucharest) {
        return res.status(400).json({
          error: { code: 'date-in-past', message: 'Requested date is in the past.' },
        });
      }

      // 3b) Effective date can't be on the restaurant's DisabledDate list.
      const effectiveDateObj = new Date(`${effectiveDateIso}T00:00:00.000Z`);
      const disabled = await prisma.disabledDate.findFirst({
        where: { restaurantId: reservation.restaurantId, date: effectiveDateObj },
      });
      if (disabled) {
        return res.status(400).json({
          error: { code: 'date-not-available', message: 'Restaurant is not taking reservations on that date.' },
        });
      }

      // 3c) Effective time must fall inside the restaurant's opening
      // hours for the effective date's weekday. Mirrors the POST
      // /reservations check at line 73-97 above — same schemaDayOfWeek
      // mapping (0=Mon..6=Sun) and same minute-of-day comparison.
      const jsDay = effectiveDateObj.getUTCDay(); // 0=Sun
      const schemaDayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
      const openingHour = await prisma.openingHours.findFirst({
        where: { restaurantId: reservation.restaurantId, dayOfWeek: schemaDayOfWeek, isOpen: true },
      });
      if (!openingHour) {
        return res.status(400).json({
          error: { code: 'time-outside-hours', message: 'Restaurant is closed on that day.' },
        });
      }
      if (!timeMinutesFitsOpenWindow(effectiveTime, openingHour.openTime, openingHour.closeTime)) {
        return res.status(400).json({
          error: { code: 'time-outside-hours', message: `Time must be between ${openingHour.openTime} and ${openingHour.closeTime}.` },
        });
      }

      // (2) One pending modification at a time per reservation. The
      // E2 ack endpoint clears the way after the diner Keeps/Cancels a
      // rejected modification (acknowledgedAt set), so this only blocks
      // truly-unresolved requests.
      const existingPending = await prisma.reservationModification.findFirst({
        where: { reservationId: id, status: 'PENDING' },
        select: { id: true },
      });
      if (existingPending) {
        return res.status(409).json({
          error: {
            code: 'modification-already-pending',
            message: 'A previous modification request is still pending. Wait for the restaurant to respond.',
            existingId: existingPending.id,
          },
        });
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

// POST /:id/modifications/:modId/ack — Tier E commit 2 (SPEC §5.6
// "keep original OR cancel after rejection"). Diner-side acknowledgement
// of a REJECTED modification. Two paths:
//   - action='keep':   stamp acknowledgedAt; reservation untouched.
//   - action='cancel': stamp acknowledgedAt AND mirror the existing
//     diner cancel path (status=CANCELLED, cancelledBy='user',
//     RESERVATION_CANCELLED_BY_DINER + reservation:cancelled emit).
// Both paths emit reservation:updated with modificationRejected:null so
// the banner clears across the diner's other devices.
router.post(
  '/:id/modifications/:modId/ack',
  authenticateUser,
  [
    param('id').isUUID(),
    param('modId').isUUID(),
    body('action').isIn(['keep', 'cancel']).withMessage('action must be "keep" or "cancel"'),
  ],
  async (req, res, next) => {
    // Validation handled manually so we can return a structured error.code
    // alongside the express-validator default shape.
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { code: 'invalid-action', message: errors.array()[0].msg } });
    }
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id, modId } = req.params;
      const { action } = req.body;

      const reservation = await prisma.reservation.findUnique({
        where: { id },
        select: { id: true, userId: true, restaurantId: true, status: true, date: true, time: true },
      });
      if (!reservation) {
        return res.status(404).json({ error: { code: 'reservation-not-found', message: 'Reservation not found.' } });
      }
      // 403 (not 404) when the row exists but belongs to a different
      // diner — leaks slightly less than 404-for-everyone and matches
      // the access-control convention used by other diner routes.
      if (reservation.userId !== userId) {
        return res.status(403).json({ error: { code: 'forbidden', message: 'Not your reservation.' } });
      }

      const modification = await prisma.reservationModification.findUnique({
        where: { id: modId },
      });
      if (!modification || modification.reservationId !== id) {
        return res.status(404).json({ error: { code: 'modification-not-found', message: 'Modification not found.' } });
      }
      if (modification.status !== 'REJECTED') {
        return res.status(400).json({ error: { code: 'modification-not-rejected', message: 'Only rejected modifications can be acknowledged.' } });
      }
      if (modification.acknowledgedAt) {
        return res.status(400).json({ error: { code: 'modification-already-acknowledged', message: 'This rejection has already been acknowledged.' } });
      }

      const now = new Date();
      const io = req.app.get('io');

      if (action === 'keep') {
        const updatedMod = await prisma.reservationModification.update({
          where: { id: modId },
          data: { acknowledgedAt: now },
        });
        // Clear the banner across all the diner's open sessions.
        io.emitToUser(userId, 'reservation:updated', {
          id: reservation.id,
          restaurantId: reservation.restaurantId,
          userId,
          modificationRejected: null,
        });
        return res.json({ acknowledgedAt: updatedMod.acknowledgedAt, reservation: null });
      }

      // action === 'cancel' — mirror the PUT /:id/cancel handler above
      // (line 374-426) field-for-field so the resulting state matches
      // what a "regular" diner cancel would have produced. Both writes
      // happen in a $transaction so a crash mid-flight can't leave the
      // mod acknowledged on a still-active reservation.
      const [, cancelled] = await prisma.$transaction([
        prisma.reservationModification.update({
          where: { id: modId },
          data: { acknowledgedAt: now },
        }),
        prisma.reservation.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancelledBy: 'user',
          },
          select: { id: true, status: true, cancelledAt: true, cancelledBy: true },
        }),
      ]);

      dispatchAsync(prisma, io, {
        event: EVENTS.RESERVATION_CANCELLED_BY_DINER,
        restaurantId: reservation.restaurantId,
        userId,
        date: reservation.date,
        time: reservation.time,
      });

      // Tier I commit 1 — auto-deactivate merge on the diner's
      // post-rejection cancel path too.
      const { deactivatedGroups } = await deactivateMergesForReservation(prisma, id);

      const cancelPayload = {
        id,
        restaurantId: reservation.restaurantId,
        userId,
        cancelledBy: 'user',
        ...cancelled,
      };
      io.emitToRestaurant(reservation.restaurantId, 'reservation:cancelled', cancelPayload);
      io.emitToUser(userId, 'reservation:cancelled', cancelPayload);
      for (const groupId of deactivatedGroups) {
        io.emitToRestaurant(reservation.restaurantId, 'table:unmerged', { groupId, deactivated: 1, reason: 'reservation-cancelled' });
      }

      res.json({ acknowledgedAt: now, reservation: cancelled });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
