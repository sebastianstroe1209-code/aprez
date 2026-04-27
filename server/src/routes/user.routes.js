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
        fcmToken: true,
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
    body('phone').optional().trim(),
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

// PUT /me/fcm-token - Update FCM push notification token
router.put(
  '/me/fcm-token',
  authenticateUser,
  [body('fcmToken').trim().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { fcmToken } = req.body;

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { fcmToken },
        select: {
          id: true,
          fcmToken: true,
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
