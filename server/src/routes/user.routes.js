const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

// Middleware to check validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
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
        language: true,
        expoPushToken: true,
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
    body('phone').optional({ checkFalsy: true }).trim().matches(/^\+40\d{9}$/).withMessage('Phone must be in +40XXXXXXXXX format'),
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

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { language },
        select: {
          id: true,
          language: true,
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

module.exports = router;
