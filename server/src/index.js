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

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/restaurant', restaurantPlatformRoutes);
app.use('/api/admin', adminRoutes);

// Socket.io connection handling
require('./socket/handlers')(io, prisma);

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
