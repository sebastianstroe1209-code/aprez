const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');

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

// POST / - Join waitlist
router.post(
  '/',
  authenticateUser,
  [
    body('restaurantId').isUUID(),
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
        where: {
          userId,
          restaurantId,
        },
      });

      if (bannedRecord) {
        return res.status(400).json({ error: 'Not available' });
      }

      // Check if user already has an active waitlist entry for this restaurant+date+time
      const existingEntry = await prisma.waitlistEntry.findFirst({
        where: {
          userId,
          restaurantId,
          date: new Date(date),
          time,
          status: 'ACTIVE',
        },
      });

      if (existingEntry) {
        return res.status(400).json({ error: 'Already on waitlist for this time' });
      }

      // Calculate position (count existing entries for same restaurant+date+time + 1)
      const entryCount = await prisma.waitlistEntry.count({
        where: {
          restaurantId,
          date: new Date(date),
          time,
          status: 'ACTIVE',
        },
      });

      const position = entryCount + 1;

      // Calculate expiry time (10 minutes after reservation time)
      const expiryTime = addMinutes(time, 10);
      const expiresAt = new Date(date);
      const [h, m] = expiryTime.split(':').map(Number);
      expiresAt.setHours(h, m, 0, 0);

      // Create waitlist entry
      const waitlistEntry = await prisma.waitlistEntry.create({
        data: {
          userId,
          restaurantId,
          date: new Date(date),
          time,
          partySize: parseInt(partySize),
          position,
          status: 'ACTIVE',
          expiresAt,
        },
        select: {
          id: true,
          restaurantId: true,
          date: true,
          time: true,
          partySize: true,
          position: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      res.status(201).json(waitlistEntry);
    } catch (error) {
      next(error);
    }
  }
);

// GET /mine - Get user's active waitlist entries
router.get('/mine', authenticateUser, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const userId = req.user.id;

    const waitlistEntries = await prisma.waitlistEntry.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        restaurantId: true,
        date: true,
        time: true,
        partySize: true,
        position: true,
        status: true,
        expiresAt: true,
        restaurant: {
          select: {
            id: true,
            name: true,
            cuisine: true,
            address: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    res.json(waitlistEntries);
  } catch (error) {
    next(error);
  }
});

// PUT /:id/cancel - Cancel waitlist entry
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

      const waitlistEntry = await prisma.waitlistEntry.findFirst({
        where: {
          id,
          userId,
        },
      });

      if (!waitlistEntry) {
        return res.status(404).json({ error: 'Waitlist entry not found' });
      }

      if (waitlistEntry.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Waitlist entry is already cancelled' });
      }

      const cancelledEntry = await prisma.waitlistEntry.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
        select: {
          id: true,
          status: true,
        },
      });

      res.json(cancelledEntry);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/confirm - Confirm waitlist spot
router.post(
  '/:id/confirm',
  authenticateUser,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { id } = req.params;

      const waitlistEntry = await prisma.waitlistEntry.findFirst({
        where: {
          id,
          userId,
        },
      });

      if (!waitlistEntry) {
        return res.status(404).json({ error: 'Waitlist entry not found' });
      }

      if (waitlistEntry.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Waitlist entry is not active' });
      }

      // Check if expiresAt hasn't passed
      const now = new Date();
      if (now > waitlistEntry.expiresAt) {
        return res.status(400).json({ error: 'Waitlist spot has expired' });
      }

      // Create a reservation from the waitlist entry
      const endTime = addMinutes(waitlistEntry.time, 120);

      const reservation = await prisma.reservation.create({
        data: {
          userId,
          restaurantId: waitlistEntry.restaurantId,
          date: waitlistEntry.date,
          time: waitlistEntry.time,
          endTime,
          partySize: waitlistEntry.partySize,
          status: 'PENDING', // Requires manual confirmation
          fromWaitlist: true,
        },
        select: {
          id: true,
          restaurantId: true,
          date: true,
          time: true,
          endTime: true,
          partySize: true,
          status: true,
          createdAt: true,
        },
      });

      // Mark waitlist entry as converted
      await prisma.waitlistEntry.update({
        where: { id },
        data: {
          status: 'CONVERTED',
        },
      });

      res.status(201).json({
        reservation,
        message: 'Successfully confirmed waitlist spot and created reservation',
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
