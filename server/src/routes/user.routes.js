const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');
const { ROMANIAN_PHONE_RE, PHONE_FORMAT_MSG, phoneFormatErrorBody } = require('../lib/phoneValidation');

const router = express.Router();

// Middleware to check validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const arr = errors.array();
    // SPEC §3.1: a phone-format failure gets the structured error.code
    // contract; other failures keep the legacy { errors: [...] } shape.
    const phoneBody = phoneFormatErrorBody(arr);
    if (phoneBody) return res.status(400).json(phoneBody);
    return res.status(400).json({ errors: arr });
  }
  next();
};

// GET /me - Get current user profile
router.get('/me', authenticateUser, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        latitude: true,
        longitude: true,
        preferredLanguage: true,
        expoPushToken: true,
        phonePromptSeenAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /me - Update user profile
router.put(
  '/me',
  authenticateUser,
  [
    body('firstName').optional().trim().isLength({ min: 1 }),
    body('lastName').optional().trim().isLength({ min: 1 }),
    body('email').optional().isEmail().normalizeEmail(),
    // SPEC §3.1: phone optional but must be +40 format (Romanian) when present.
    body('phone').optional({ checkFalsy: true }).trim().matches(ROMANIAN_PHONE_RE).withMessage(PHONE_FORMAT_MSG),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { firstName, lastName, email, phone } = req.body;

      const updateData = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (email !== undefined) updateData.email = email;
      if (phone !== undefined) updateData.phone = phone;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          updatedAt: true,
        },
      });

      res.json(updatedUser);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /me/location - Update GPS location
router.put(
  '/me/location',
  authenticateUser,
  [
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { latitude, longitude } = req.body;

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { latitude, longitude },
        select: {
          id: true,
          latitude: true,
          longitude: true,
          updatedAt: true,
        },
      });

      res.json(updatedUser);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /me/language - Update preferred language
router.put(
  '/me/language',
  authenticateUser,
  [body('language').isIn(['ro', 'en'])],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { language } = req.body;

      // Schema column is `preferredLanguage` (mapped to preferred_language).
      // Body field stays `language` for ergonomics. Pre-C5 the route
      // referenced `language` directly which would have thrown
      // PrismaClientValidationError at first call — fixed as part of C5
      // because the mobile + web language toggles depend on this endpoint.
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { preferredLanguage: language },
        select: {
          id: true,
          preferredLanguage: true,
          updatedAt: true,
        },
      });

      res.json(updatedUser);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /me/push-token - Register the diner's Expo Push token. Mobile app
// calls this after Expo's getExpoPushTokenAsync() at login. Token format
// is validated server-side at send time (see channels/push.js).
router.put(
  '/me/push-token',
  authenticateUser,
  [body('expoPushToken').trim().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { expoPushToken } = req.body;

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { expoPushToken },
        select: {
          id: true,
          expoPushToken: true,
          updatedAt: true,
        },
      });

      res.json(updatedUser);
    } catch (error) {
      next(error);
    }
  }
);

// POST /me/phone-prompt-seen — Tier D commit 2. Stamps phonePromptSeenAt
// so the post-first-reservation phone prompt doesn't reappear (whether the
// diner submitted a phone or tapped "Maybe later"). Idempotent.
router.post('/me/phone-prompt-seen', authenticateUser, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const userId = req.user.id;
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { phonePromptSeenAt: new Date() },
      select: { id: true, phonePromptSeenAt: true },
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /me — GDPR §5.9 account deletion. Soft-deletes the User row
// (sets deletedAt; auth middleware then rejects any outstanding JWTs) and
// anonymizes PII on historical reservations so the restaurant-side audit
// trail stays intact without identifying the diner. We do NOT cascade-
// delete reservations: bookings already honored matter for the restaurant
// billing report and the diner's old confirmation emails reference them.
router.delete('/me', authenticateUser, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const userId = req.user.id;

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, deletedAt: true },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }
    if (existing.deletedAt) {
      // Idempotent: a second DELETE on an already-deleted account is a
      // no-op rather than an error so a duplicate tap doesn't 500.
      return res.json({ message: 'Account already deleted.' });
    }

    const displayName = `${existing.firstName || ''} ${existing.lastName || ''}`.trim() || '[deleted account]';

    // PII wipe on reservations: replace guest contact fields with neutral
    // sentinels so the restaurant's view shows "[deleted account]" rather
    // than an empty cell. Match the convention used elsewhere when staff
    // anonymize cancelled walk-ins.
    //
    // K10 — also cancel every non-terminal reservation atomically. Pre-K10
    // the PII was wiped but `status` stayed PENDING/CONFIRMED/AUTO_CONFIRMED,
    // leaving the restaurant with a ghost row they couldn't call/cancel.
    // cancelledBy='system' distinguishes deletion-cancellations from
    // diner-initiated ('user') and restaurant-initiated ('restaurant').
    const now = new Date();
    await prisma.$transaction([
      prisma.reservation.updateMany({
        where: { userId },
        data: {
          guestName: '[deleted account]',
          guestPhone: null,
          guestEmail: null,
        },
      }),
      prisma.reservation.updateMany({
        where: {
          userId,
          status: { in: ['PENDING', 'CONFIRMED', 'AUTO_CONFIRMED'] },
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: 'system',
        },
      }),
      // Soft-delete: keep the row so FKs from Reservation/Favorite/etc.
      // don't break, but null-out PII and stamp deletedAt. The unique
      // (email, phone) indexes still hold the original values — we null
      // them so the diner can re-register with the same email later.
      prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          email: null,
          phone: null,
          passwordHash: null,
          expoPushToken: null,
          latitude: null,
          longitude: null,
          firstName: '[deleted',
          lastName: 'account]',
        },
      }),
      // Drop favorites — they hold no PII but they're personal preference
      // data and shouldn't survive deletion.
      prisma.favorite.deleteMany({ where: { userId } }),
      // Invalidate any outstanding password-reset tokens for this user.
      prisma.passwordResetToken.updateMany({
        where: { userId, userType: 'user', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ message: 'Account deleted.', deletedDisplayName: displayName });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
