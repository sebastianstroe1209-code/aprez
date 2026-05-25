require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');

// Initialize
const app = express();
// K2 — don't leak the framework in response headers.
app.disable('x-powered-by');
// K3 — trust the single proxy hop in front of us (Render's edge /
// Cloudflare) so X-Forwarded-For yields real client IPs to
// express-rate-limit. Bounded to 1 so a downstream attacker cannot
// spoof additional hops. Off-Render this is a no-op (no XFF header).
app.set('trust proxy', 1);
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
// K2 — helmet ships sensible defaults for HSTS, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, etc. CSP is DISABLED for
// now — we haven't audited inline scripts on the Next.js apps or the
// uploaded photo paths; turning CSP on without an audit would break
// production pages. Re-enable in a later tier after a CSP audit.
app.use(helmet({ contentSecurityPolicy: false }));
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

// Tier K3 follow-up — temporary diagnostic to figure out what req.ip
// actually resolves to behind Cloudflare + Render. Sebastian's live
// rate-limit verification found 7 wrong-password POSTs all returned
// 401, never 429. Need real data on what `trust proxy` is yielding
// before deciding whether to bump it, switch to a CF-Connecting-IP
// keyGenerator, etc. Returns the request's resolved IP + the raw
// headers Express used to derive it. SAFE to leave on production
// briefly — it leaks no secrets, only your own IP back at you and
// the headers your own client sent.
app.get('/api/__diag/ip', (req, res) => {
  res.json({
    reqIp: req.ip,
    reqIps: req.ips,
    socketRemote: req.socket?.remoteAddress,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'] || null,
      'cf-connecting-ip': req.headers['cf-connecting-ip'] || null,
      'x-real-ip': req.headers['x-real-ip'] || null,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || null,
    },
    trustProxy: app.get('trust proxy'),
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

// Dev/test-only rate-limit reset. Returns 404 in production so it's a
// no-op in the live environment; the K3 smoke calls it at startup so
// re-running within an hour doesn't trip the per-IP forgot-password
// bucket from the previous run.
app.post('/api/__test/reset-rate-limits', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: { code: 'not-found' } });
  }
  const { resetAllLimitersForTests } = require('./middleware/rateLimiters');
  await resetAllLimitersForTests();
  res.json({ ok: true });
});

// Health check — also serves as a deploy diagnostic. On Render the
// RENDER_GIT_COMMIT env var is injected at build time; locally it's
// unset so `commit` reports 'local'. Lets us curl the live URL and
// instantly verify which SHA is serving (was: blind faith that the
// auto-deploy fired). See memory/tier_k_findings.md K0.
app.get('/api/health', (req, res) => {
  const commit = process.env.RENDER_GIT_COMMIT
    ? process.env.RENDER_GIT_COMMIT.slice(0, 7)
    : 'local';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit,
    env: process.env.NODE_ENV || 'development',
  });
});

// Routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const restaurantRoutes = require('./routes/restaurant.routes');
const reservationRoutes = require('./routes/reservation.routes');
const favoriteRoutes = require('./routes/favorite.routes');
const restaurantPlatformRoutes = require('./routes/restaurantPlatform.routes');
const restaurantUploadsRoutes = require('./routes/restaurantUploads.routes');
const adminRoutes = require('./routes/admin.routes');
const uploadsRoutes = require('./routes/uploads.routes');
const { UPLOADS_DIR } = require('./lib/uploads');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/restaurant', restaurantPlatformRoutes);
app.use('/api/restaurant', restaurantUploadsRoutes); // Tier G3: staff photo + menu uploads
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

// Error handling middleware — K1 sanitizer.
//
// Pre-K1, an unhandled Prisma error returned 500 with `err.message`
// echoed in the response body. Prisma's validation error messages
// include the full UserWhereInput schema (column names like
// passwordHash, expoPushToken, deletedAt) — a free schema dump for
// attackers. Now: production NEVER echoes Prisma details or stack
// traces; dev keeps the verbose form for fast debugging.
app.use((err, req, res, next) => {
  // Always log server-side — this is our only visibility.
  console.error('[error]', req.method, req.originalUrl, '-', err.name || 'Error', '-', err.message);
  if (err.stack) console.error(err.stack);

  const isProd = process.env.NODE_ENV === 'production';
  const isPrismaError = typeof err.name === 'string' && err.name.startsWith('PrismaClient');
  const status = err.status || 500;

  if (isProd) {
    // Production: any 5xx or Prisma error → generic. Curated 4xx
    // messages (set via err.status + err.message in a route) still
    // surface so the client can localize / display them.
    if (isPrismaError || status >= 500) {
      return res.status(500).json({
        error: { code: 'server-error', message: 'Something went wrong. Please try again.' },
      });
    }
    return res.status(status).json({
      error: { message: err.message || 'Bad request' },
    });
  }

  // Dev: keep the verbose form.
  res.status(status).json({
    error: {
      message: err.message || 'Internal server error',
      stack: err.stack,
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
