require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');

// Initialize
const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

// Socket.io for real-time features
const io = new Server(server, {
  cors: {
    origin: [
      process.env.CLIENT_URL || 'http://localhost:3000',
      process.env.RESTAURANT_URL || 'http://localhost:3001',
      process.env.ADMIN_URL || 'http://localhost:3002',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

// Make prisma and io available to routes
app.set('prisma', prisma);
app.set('io', io);

// Middleware
app.use(cors({
  origin: [
    process.env.CLIENT_URL || 'http://localhost:3000',
    process.env.RESTAURANT_URL || 'http://localhost:3001',
    process.env.ADMIN_URL || 'http://localhost:3002',
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const restaurantRoutes = require('./routes/restaurant.routes');
const reservationRoutes = require('./routes/reservation.routes');
const favoriteRoutes = require('./routes/favorite.routes');
const restaurantPlatformRoutes = require('./routes/restaurantPlatform.routes');
const adminRoutes = require('./routes/admin.routes');
const uploadsRoutes = require('./routes/uploads.routes');
const { UPLOADS_DIR } = require('./lib/uploads');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/restaurant', restaurantPlatformRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', uploadsRoutes); // Tier F: photo + menu uploads (admin-only)

// Tier F: static-serve uploaded photos + menus. Reads are public — the
// diner mobile app needs to fetch cover photos on the public restaurant
// list. The DB stores paths like `/uploads/{rid}/photos/{filename}` so
// this mount aligns with the value sent back from the upload endpoints.
app.use('/uploads', express.static(UPLOADS_DIR, {
  fallthrough: true,
  maxAge: '7d',  // cache photos at the CDN/browser layer for a week
}));

// Socket.io connection handling
require('./socket/handlers')(io, prisma);

// SPEC §3.2 — 30-day reservation pruning. Day-granular, so it runs on
// its own interval rather than the minute-tick table-status loop in
// socket/handlers.js — a failure here must not stall those jobs. Runs
// once at boot, then every 24h. The job is idempotent.
const { pruneOldReservations } = require('./jobs/pruneOldReservations');
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
async function runReservationPrune() {
  try {
    await pruneOldReservations(prisma, new Date());
  } catch (err) {
    console.error('[prune:reservations] failed:', err.message);
  }
}
runReservationPrune();
setInterval(runReservationPrune, PRUNE_INTERVAL_MS);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`ApRez API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});

module.exports = { app, server, prisma, io };
