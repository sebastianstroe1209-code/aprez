// Socket.io Real-time Event Handlers
// Handles LIVE mode, reservation updates, and notifications

const { EVENTS, dispatchAsync } = require('../services/notifications');
const { checkAndFireRemindersFor } = require('../jobs/reminders');

module.exports = (io, prisma) => {
  // Track which restaurants are connected (for targeted events)
  const restaurantRooms = new Map(); // restaurantId -> Set of socket IDs

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Restaurant staff joins their restaurant's room
    socket.on('join:restaurant', (restaurantId) => {
      socket.join(`restaurant:${restaurantId}`);
      socket.restaurantId = restaurantId;
      console.log(`Socket ${socket.id} joined restaurant:${restaurantId}`);
    });

    // User joins their personal room (for notifications)
    socket.on('join:user', (userId) => {
      socket.join(`user:${userId}`);
      socket.userId = userId;
      console.log(`Socket ${socket.id} joined user:${userId}`);
    });

    // ============================================
    // TABLE STATUS CHANGES (LIVE MODE)
    // ============================================
    socket.on('table:updateStatus', async (data) => {
      const { tableId, status, guestCount } = data;
      try {
        const table = await prisma.restaurantTable.update({
          where: { id: tableId },
          data: {
            status,
            statusChangedAt: new Date(),
          },
        });

        // Broadcast to all staff in this restaurant
        io.to(`restaurant:${table.restaurantId}`).emit('table:statusChanged', {
          tableId: table.id,
          status: table.status,
          statusChangedAt: table.statusChangedAt,
          guestCount,
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to update table status' });
      }
    });

    // ============================================
    // TABLE MOVE (LIVE MODE)
    // ============================================
    socket.on('table:move', async (data) => {
      try {
        io.to(`restaurant:${socket.restaurantId}`).emit('table:moved', data);
      } catch (error) {
        socket.emit('error', { message: 'Failed to move table' });
      }
    });

    // ============================================
    // DISCONNECT
    // ============================================
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  // ============================================
  // SERVER-SIDE EVENT EMITTERS
  // These are called from route handlers
  // ============================================

  // Emit to a specific restaurant's staff
  io.emitToRestaurant = (restaurantId, event, data) => {
    io.to(`restaurant:${restaurantId}`).emit(event, data);
  };

  // Emit to a specific user
  io.emitToUser = (userId, event, data) => {
    io.to(`user:${userId}`).emit(event, data);
  };

  // ============================================
  // SCHEDULED TIMERS
  // Check every minute for:
  // 1. Tables that should turn ORANGE (arriving soon - 1h before reservation)
  // 2. Tables that should turn LIGHT RED (awaiting guest - at reservation time)
  // 3. 120-minute occupied timer expiry
  // 4. Light Red 15-minute reminders
  // 5. 45-minute pre-reservation reminders
  // ============================================

  const TIMER_INTERVAL = 60 * 1000; // Check every minute

  // In-memory dedup so the per-minute tick doesn't persist a Notification row
  // every minute past the threshold. Keyed by `${tableId}:${statusChangedAt}`.
  // Cleared on process restart — acceptable for MVP since a missed reminder
  // post-restart is preferable to spamming the dashboard.
  const dispatchedTimer120 = new Set();
  const dispatchedTimerAwaiting = new Set(); // key adds the 15-min bucket

  setInterval(async () => {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 1. Find reservations starting within 1 hour — set tables to ARRIVING_SOON
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const oneHourTime = `${String(oneHourFromNow.getHours()).padStart(2, '0')}:${String(oneHourFromNow.getMinutes()).padStart(2, '0')}`;

      const upcomingReservations = await prisma.reservation.findMany({
        where: {
          date: new Date(today),
          time: { lte: oneHourTime, gt: currentTime },
          status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] },
          tableId: { not: null },
        },
        include: { table: true },
      });

      for (const res of upcomingReservations) {
        if (res.table && res.table.status === 'FREE') {
          await prisma.restaurantTable.update({
            where: { id: res.table.id },
            data: { status: 'ARRIVING_SOON', statusChangedAt: now },
          });
          io.emitToRestaurant(res.restaurantId, 'table:statusChanged', {
            tableId: res.table.id,
            status: 'ARRIVING_SOON',
            statusChangedAt: now,
          });
        }
      }

      // 2. Find reservations at current time — set tables to AWAITING_GUEST
      const atTimeReservations = await prisma.reservation.findMany({
        where: {
          date: new Date(today),
          time: currentTime,
          status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] },
          seatedAt: null,
          tableId: { not: null },
        },
        include: { table: true },
      });

      for (const res of atTimeReservations) {
        if (res.table && res.table.status !== 'OCCUPIED') {
          await prisma.restaurantTable.update({
            where: { id: res.table.id },
            data: { status: 'AWAITING_GUEST', statusChangedAt: now },
          });
          io.emitToRestaurant(res.restaurantId, 'table:statusChanged', {
            tableId: res.table.id,
            status: 'AWAITING_GUEST',
            statusChangedAt: now,
          });
        }
      }

      // 3. Check 120-minute timer on OCCUPIED tables
      const occupiedTables = await prisma.restaurantTable.findMany({
        where: { status: 'OCCUPIED', statusChangedAt: { not: null } },
      });

      for (const table of occupiedTables) {
        const elapsed = (now - new Date(table.statusChangedAt)) / (1000 * 60);
        if (elapsed >= 120) {
          io.emitToRestaurant(table.restaurantId, 'timer:expired', {
            tableId: table.id,
            tableNumber: table.tableNumber,
            elapsedMinutes: Math.round(elapsed),
          });
          const key = `${table.id}:${new Date(table.statusChangedAt).getTime()}`;
          if (!dispatchedTimer120.has(key)) {
            dispatchedTimer120.add(key);
            dispatchAsync(prisma, io, {
              event: EVENTS.TABLE_TIMER_120_EXPIRED,
              restaurantId: table.restaurantId,
              tableNumber: table.tableNumber,
              elapsedMinutes: Math.round(elapsed),
            });
          }
        }
      }

      // 4. Light Red 15-minute reminders
      const awaitingTables = await prisma.restaurantTable.findMany({
        where: { status: 'AWAITING_GUEST', statusChangedAt: { not: null } },
      });

      for (const table of awaitingTables) {
        const elapsed = (now - new Date(table.statusChangedAt)) / (1000 * 60);
        if (elapsed >= 15 && Math.floor(elapsed) % 15 === 0) {
          io.emitToRestaurant(table.restaurantId, 'timer:lightRedReminder', {
            tableId: table.id,
            tableNumber: table.tableNumber,
            waitingMinutes: Math.round(elapsed),
          });
          const bucket = Math.floor(elapsed / 15) * 15;
          const key = `${table.id}:${new Date(table.statusChangedAt).getTime()}:${bucket}`;
          if (!dispatchedTimerAwaiting.has(key)) {
            dispatchedTimerAwaiting.add(key);
            dispatchAsync(prisma, io, {
              event: EVENTS.TABLE_AWAITING_15_REMINDER,
              restaurantId: table.restaurantId,
              tableNumber: table.tableNumber,
              waitingMinutes: Math.round(elapsed),
            });
          }
        }
      }

      // 5. 45-minute reminders for upcoming reservations.
      // Delegated to jobs/reminders.js — Bucharest wall-clock window with
      // dedup via Reservation.reminderSentAt. SPEC §5.7.
      await checkAndFireRemindersFor(prisma, io, now);

    } catch (error) {
      console.error('Timer check error:', error.message);
    }
  }, TIMER_INTERVAL);
};
