const express = require('express');
const { param, body, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const restaurantSelect = {
  id: true,
  nameRo: true,
  nameEn: true,
  cuisineTypes: true,
  address: true,
  phone: true,
  coverPhotoUrl: true,
};

// GET / - Get user's favorite restaurants
router.get('/', authenticateUser, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const userId = req.user.id;

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      select: {
        id: true,
        restaurantId: true,
        restaurant: { select: restaurantSelect },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(favorites);
  } catch (error) {
    next(error);
  }
});

// POST / - Add to favorites (accepts restaurantId in body)
router.post(
  '/',
  authenticateUser,
  [body('restaurantId').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { restaurantId } = req.body;

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true },
      });

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const existing = await prisma.favorite.findFirst({
        where: { userId, restaurantId },
      });

      if (existing) {
        return res.status(400).json({ error: 'Already in favorites' });
      }

      const favorite = await prisma.favorite.create({
        data: { userId, restaurantId },
        select: {
          id: true,
          restaurantId: true,
          restaurant: { select: restaurantSelect },
          createdAt: true,
        },
      });

      res.status(201).json(favorite);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:restaurantId - Remove from favorites
router.delete(
  '/:restaurantId',
  authenticateUser,
  [param('restaurantId').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const userId = req.user.id;
      const { restaurantId } = req.params;

      const favorite = await prisma.favorite.findFirst({
        where: { userId, restaurantId },
      });

      if (!favorite) {
        return res.status(404).json({ error: 'Favorite not found' });
      }

      await prisma.favorite.delete({
        where: { id: favorite.id },
      });

      res.json({ message: 'Removed from favorites' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
