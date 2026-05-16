// Socket.io Real-time Event Handlers
// Handles LIVE mode, reservation updates, and notifications.
// Event names follow the §5a contract in memory/waiter_ux_strategy.md (kebab-case).

const jwt = require('jsonwebtoken');
const { EVENTS, dispatchAsync } = require('../services/notifications');
const { checkAndFireRemindersFor } = require('../jobs/reminders');

module.exports = (io, prisma) => {
  // JWT handshake middleware (C4).
  // Clients pass their token via `auth.token` in the io() options. We verify
  // here and stash the decoded payload on the socket so the connection handler
  // can auto-join the correct room. Tokenless connections are allowed but get
  // no auto-join — they can still self-declare via the legacy join:* events,
  // which is what the dev/test scripts rely on.
  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
    if (!token) {
      socket.userPayload = null;
      return next();
    }
    try {
      socket.userPayload = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (err) {
      // Bad token: refuse the connection so the client can re-auth instead of
      // silently receiving no events.
      next(new Error('invalid_token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (role=${socket.userPayload?.role || 'anon'})`);

    // Auto-join based on JWT role.
    if (socket.userPayload) {
      const { role, id, restaurantId } = socket.userPayload;
      if (role === 'restaurant' && restaurantId) {
        socket.join(`restaurant:${restaurantId}`);
        socket.restaurantId = restaurantId;
      } else if (role === 'user' && id) {
        socket.join(`user:${id}`);
        socket.userId = id;
      } else if (role === 'admin') {
        socket.join('admin:global');
        socket.isAdmin = true;
      }
    }

    // Legacy self-declared joins (kept for back-compat with dev/test scripts
    // that connect without a token).
    socket.on('join:restaurant', (restaurantId) => {
      socket.join(`restaurant:${restaurantId}`);
      socket.restaurantId = restaurantId;
    });
    socket.on('join:user', (userId) => {
      socket.join(`user:${userId}`);
      socket.userId = userId;
    });

    // ============================================
    // TABLE STATUS CHANGES (LIVE MODE)
    // Kept for the live-page socket shortcut; REST endpoint is authoritative.
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

        io.to(`restaurant:${table.restaurantId}`).emit('table:status-changed', {
          tableId: table.id,
          newStatus: table.status,
          statusChangedAt: table.statusChangedAt,
          guestCount,
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to update table status' });
      }
    });

    socket.on('table:move', async (data) => {
      try {
        io.to(`restaurant:${socket.restaurantId}`).emit('table:moved', data);
      } catch (error) {
        socket.emit('error', { message: 'Failed to move table' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  // ============================================
  // SERVER-SIDE EVENT EMITTERS (called from route handlers)
  // ============================================

  io.emitToRestaurant = (restaurantId, event, data) => {
    io.to(`restaurant:${restaurantId}`).emit(event, data);
  };

  io.emitToUser = (userId, event, data) => {
    io.to(`user:${userId}`).emit(event, data);
  };

  io.emitToAdmins = (event, data) => {
    io.to('admin:global').emit(event, data);
  };

  // ============================================
  // SCHEDULED TIMERS (every minute)
  // ============================================

  const TIMER_INTERVAL = 60 * 1000;
  const dispatchedTimer120 = new Set();
  const dispatchedTimerAwaiting = new Set();

  setInterval(async () => {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
          io.emitToRestaurant(res.restaurantId, 'table:status-changed', {
            tableId: res.table.id,
            newStatus: 'ARRIVING_SOON',
            statusChangedAt: now,
          });
        }
      }

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
          io.emitToRestaurant(res.restaurantId, 'table:status-changed', {
            tableId: res.table.id,
            newStatus: 'AWAITING_GUEST',
            statusChangedAt: now,
          });
        }
      }

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

      await checkAndFireRemindersFor(prisma, io, now);

    } catch (error) {
      console.error('Timer check error:', error.message);
    }
  }, TIMER_INTERVAL);
};
