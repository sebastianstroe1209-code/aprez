const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

// Log all admin requests for debugging
router.use((req, res, next) => {
  console.log(`[ADMIN] ${req.method} ${req.originalUrl}`);
  next();
});

// Helper functions
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateUsername(name) {
  const base = name.toLowerCase().replace(/\s+/g, '');
  const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${base}${suffix}`;
}

async function logAdminAction(prisma, adminUserId, action, targetType, targetId, details) {
  return prisma.adminAuditLog.create({
    data: {
      adminUserId,
      action,
      targetType,
      targetId,
      details,
    },
  });
}

// Middleware for validation error handling
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ============================================
// RESTAURANT CRUD
// ============================================

// POST /restaurants - Create restaurant
router.post(
  '/restaurants',
  authenticateAdmin,
  [
    body('nameRo').notEmpty().trim(),
    body('nameEn').notEmpty().trim(),
    body('address').notEmpty().trim(),
    body('phone').notEmpty().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const {
        nameRo,
        nameEn,
        descriptionRo,
        descriptionEn,
        cuisineTypes,
        address,
        latitude,
        longitude,
        googlePlaceId,
        phone,
        email,
        website,
        menuPdfUrl,
        coverPhotoUrl,
      } = req.body;

      // Create restaurant
      const { maxPartySize, autoConfirmEnabled } = req.body;
      const restaurant = await prisma.restaurant.create({
        data: {
          nameRo,
          nameEn,
          descriptionRo: descriptionRo || null,
          descriptionEn: descriptionEn || null,
          cuisineTypes: cuisineTypes || [],
          address,
          latitude: latitude ? parseFloat(latitude) : 0,
          longitude: longitude ? parseFloat(longitude) : 0,
          googlePlaceId: googlePlaceId || null,
          phone,
          email: email || null,
          website: website || null,
          menuPdfUrl: menuPdfUrl || null,
          coverPhotoUrl: coverPhotoUrl || null,
          maxPartySize: maxPartySize ? parseInt(maxPartySize) : 30,
          autoConfirmEnabled: autoConfirmEnabled !== undefined ? autoConfirmEnabled : true,
        },
      });

      // Create opening hours if provided
      const { openingHours, servicePeriods } = req.body;
      if (openingHours && Array.isArray(openingHours)) {
        const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        for (const oh of openingHours) {
          const dayIndex = DAYS.indexOf(oh.day);
          if (dayIndex === -1) continue;
          await prisma.openingHours.create({
            data: {
              restaurantId: restaurant.id,
              dayOfWeek: dayIndex,
              isOpen: oh.isOpen !== false,
              openTime: oh.openTime || '09:00',
              closeTime: oh.closeTime || '23:00',
            },
          });
        }
      }

      // Create service periods if provided
      if (servicePeriods && Array.isArray(servicePeriods)) {
        for (const sp of servicePeriods) {
          if (!sp.nameRo && !sp.nameEn) continue;
          await prisma.servicePeriod.create({
            data: {
              restaurantId: restaurant.id,
              nameRo: sp.nameRo || sp.nameEn,
              nameEn: sp.nameEn || sp.nameRo,
              startTime: sp.startTime || '12:00',
              endTime: sp.endTime || '15:00',
              daysOfWeek: Array.isArray(sp.daysOfWeek) ? sp.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
            },
          });
        }
      }

      // Generate staff credentials
      const username = generateUsername(nameEn);
      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);

      const staff = await prisma.restaurantStaff.create({
        data: {
          restaurantId: restaurant.id,
          username,
          passwordHash,
          displayName: nameEn,
        },
      });

      // Log action
      await logAdminAction(prisma, adminUserId, 'created_restaurant', 'restaurant', restaurant.id, {
        nameEn,
        nameRo,
      });

      res.status(201).json({
        restaurant,
        credentials: {
          username,
          password,
          staffId: staff.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /restaurants - List all restaurants
router.get('/restaurants', authenticateAdmin, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');

    const restaurants = await prisma.restaurant.findMany({
      select: {
        id: true,
        nameRo: true,
        nameEn: true,
        cuisineTypes: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(restaurants);
  } catch (error) {
    next(error);
  }
});

// GET /restaurants/:id - Get full restaurant details
router.get(
  '/restaurants/:id',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;

      const restaurant = await prisma.restaurant.findUnique({
        where: { id },
        include: {
          openingHours: {
            orderBy: { dayOfWeek: 'asc' },
          },
          servicePeriods: true,
          tableSections: {
            include: {
              tables: {
                select: {
                  id: true,
                  tableNumber: true,
                  seatCount: true,
                  gridRow: true,
                  gridCol: true,
                  status: true,
                  isActive: true,
                },
              },
            },
          },
          staff: {
            select: {
              id: true,
              displayName: true,
              username: true,
              createdAt: true,
            },
          },
        },
      });

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      res.json(restaurant);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /restaurants/:id - Edit restaurant profile
router.put(
  '/restaurants/:id',
  authenticateAdmin,
  [
    param('id').notEmpty().trim(),
    body('nameRo').optional().trim(),
    body('nameEn').optional().trim(),
    body('descriptionRo').optional().trim(),
    body('descriptionEn').optional().trim(),
    body('cuisineTypes').optional().isArray(),
    body('phone').optional().trim(),
    body('email').optional().trim(),
    body('website').optional().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;
      const { nameRo, nameEn, descriptionRo, descriptionEn, cuisineTypes, phone, email, website } = req.body;

      const updateData = {};
      if (nameRo !== undefined) updateData.nameRo = nameRo;
      if (nameEn !== undefined) updateData.nameEn = nameEn;
      if (descriptionRo !== undefined) updateData.descriptionRo = descriptionRo;
      if (descriptionEn !== undefined) updateData.descriptionEn = descriptionEn;
      if (cuisineTypes !== undefined) updateData.cuisineTypes = cuisineTypes;
      if (phone !== undefined) updateData.phone = phone;
      if (email !== undefined) updateData.email = email;
      if (website !== undefined) updateData.website = website;

      const updated = await prisma.restaurant.update({
        where: { id },
        data: updateData,
      });

      // Update opening hours if provided (delete + recreate)
      const { openingHours, servicePeriods } = req.body;
      if (openingHours && Array.isArray(openingHours)) {
        await prisma.openingHours.deleteMany({ where: { restaurantId: id } });
        const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        for (const oh of openingHours) {
          const dayIndex = DAYS.indexOf(oh.day);
          if (dayIndex === -1) continue;
          await prisma.openingHours.create({
            data: {
              restaurantId: id,
              dayOfWeek: dayIndex,
              isOpen: oh.isOpen !== false,
              openTime: oh.openTime || '09:00',
              closeTime: oh.closeTime || '23:00',
            },
          });
        }
      }

      // Update service periods if provided (delete + recreate)
      if (servicePeriods && Array.isArray(servicePeriods)) {
        await prisma.servicePeriod.deleteMany({ where: { restaurantId: id } });
        for (const sp of servicePeriods) {
          if (!sp.nameRo && !sp.nameEn) continue;
          await prisma.servicePeriod.create({
            data: {
              restaurantId: id,
              nameRo: sp.nameRo || sp.nameEn,
              nameEn: sp.nameEn || sp.nameRo,
              startTime: sp.startTime || '12:00',
              endTime: sp.endTime || '15:00',
              daysOfWeek: Array.isArray(sp.daysOfWeek) ? sp.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
            },
          });
        }
      }

      await logAdminAction(prisma, adminUserId, 'edited_restaurant', 'restaurant', id, updateData);

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /restaurants/:id/deactivate - Deactivate restaurant
router.put(
  '/restaurants/:id/deactivate',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const updated = await prisma.restaurant.update({
        where: { id },
        data: { isActive: false },
      });

      await logAdminAction(prisma, adminUserId, 'deactivated_restaurant', 'restaurant', id, {});

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /restaurants/:id/activate - Activate restaurant
router.put(
  '/restaurants/:id/activate',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const updated = await prisma.restaurant.update({
        where: { id },
        data: { isActive: true },
      });

      await logAdminAction(prisma, adminUserId, 'activated_restaurant', 'restaurant', id, {});

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// TABLE LAYOUT
// ============================================

// POST /restaurants/:id/sections - Create floor section
router.post(
  '/restaurants/:id/sections',
  authenticateAdmin,
  [
    param('id').notEmpty().trim(),
    body('nameRo').notEmpty().trim(),
    body('nameEn').notEmpty().trim(),
    body('gridRows').isInt({ min: 1 }),
    body('gridColumns').isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;
      const { nameRo, nameEn, gridRows, gridColumns } = req.body;

      // Verify restaurant exists
      const restaurant = await prisma.restaurant.findUnique({ where: { id } });
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const section = await prisma.tableSection.create({
        data: {
          restaurantId: id,
          nameRo,
          nameEn,
          gridRows: parseInt(gridRows),
          gridColumns: parseInt(gridColumns),
        },
      });

      await logAdminAction(prisma, adminUserId, 'created_section', 'table_section', section.id, {
        nameEn,
        nameRo,
      });

      res.status(201).json(section);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /sections/:id - Edit section
router.put(
  '/sections/:id',
  authenticateAdmin,
  [
    param('id').isUUID(),
    body('nameRo').optional().trim(),
    body('nameEn').optional().trim(),
    body('gridRows').optional().isInt({ min: 1 }),
    body('gridColumns').optional().isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;
      const { nameRo, nameEn, gridRows, gridColumns } = req.body;

      const updateData = {};
      if (nameRo !== undefined) updateData.nameRo = nameRo;
      if (nameEn !== undefined) updateData.nameEn = nameEn;
      if (gridRows !== undefined) updateData.gridRows = parseInt(gridRows);
      if (gridColumns !== undefined) updateData.gridColumns = parseInt(gridColumns);

      const updated = await prisma.tableSection.update({
        where: { id },
        data: updateData,
      });

      await logAdminAction(prisma, adminUserId, 'edited_section', 'table_section', id, updateData);

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /sections/:id - Delete section and tables
router.delete(
  '/sections/:id',
  authenticateAdmin,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const section = await prisma.tableSection.findUnique({ where: { id } });
      if (!section) {
        return res.status(404).json({ error: 'Section not found' });
      }

      // Delete section (cascades to tables)
      await prisma.tableSection.delete({ where: { id } });

      await logAdminAction(prisma, adminUserId, 'deleted_section', 'table_section', id, {});

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// POST /sections/:id/tables - Add table to section
router.post(
  '/sections/:id/tables',
  authenticateAdmin,
  [
    param('id').isUUID(),
    body('tableNumber').notEmpty().trim(),
    body('seatCount').isInt({ min: 1 }),
    body('gridRow').isInt({ min: 0 }),
    body('gridCol').isInt({ min: 0 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;
      const { tableNumber, seatCount, gridRow, gridCol } = req.body;

      const section = await prisma.tableSection.findUnique({
        where: { id },
        select: { restaurantId: true },
      });

      if (!section) {
        return res.status(404).json({ error: 'Section not found' });
      }

      const table = await prisma.restaurantTable.create({
        data: {
          sectionId: id,
          restaurantId: section.restaurantId,
          tableNumber,
          seatCount: parseInt(seatCount),
          gridRow: parseInt(gridRow),
          gridCol: parseInt(gridCol),
        },
      });

      await logAdminAction(prisma, adminUserId, 'created_table', 'restaurant_table', table.id, {
        tableNumber,
        seatCount,
      });

      res.status(201).json(table);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /tables/:id - Edit table
router.put(
  '/tables/:id',
  authenticateAdmin,
  [
    param('id').isUUID(),
    body('tableNumber').optional().trim(),
    body('seatCount').optional().isInt({ min: 1 }),
    body('gridRow').optional().isInt({ min: 0 }),
    body('gridCol').optional().isInt({ min: 0 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;
      const { tableNumber, seatCount, gridRow, gridCol } = req.body;

      const updateData = {};
      if (tableNumber !== undefined) updateData.tableNumber = tableNumber;
      if (seatCount !== undefined) updateData.seatCount = parseInt(seatCount);
      if (gridRow !== undefined) updateData.gridRow = parseInt(gridRow);
      if (gridCol !== undefined) updateData.gridCol = parseInt(gridCol);

      const updated = await prisma.restaurantTable.update({
        where: { id },
        data: updateData,
      });

      await logAdminAction(prisma, adminUserId, 'edited_table', 'restaurant_table', id, updateData);

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /tables/:id - Remove table
router.delete(
  '/tables/:id',
  authenticateAdmin,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      console.log('[DELETE TABLE] Attempting to delete table with ID:', id);

      const table = await prisma.restaurantTable.findUnique({ where: { id } });
      console.log('[DELETE TABLE] Found table:', table ? 'yes' : 'no');
      if (!table) {
        return res.status(404).json({ error: `Table not found (ID: ${id})` });
      }

      await prisma.restaurantTable.delete({ where: { id } });
      console.log('[DELETE TABLE] Successfully deleted table:', id);

      await logAdminAction(prisma, adminUserId, 'deleted_table', 'restaurant_table', id, {});

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// GET /restaurants/:id/layout-preview - Get full layout
router.get(
  '/restaurants/:id/layout-preview',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;

      const sections = await prisma.tableSection.findMany({
        where: { restaurantId: id },
        include: {
          tables: {
            where: { isActive: true },
            select: {
              id: true,
              tableNumber: true,
              seatCount: true,
              gridRow: true,
              gridCol: true,
              status: true,
            },
            orderBy: [{ gridRow: 'asc' }, { gridCol: 'asc' }],
          },
        },
        orderBy: { displayOrder: 'asc' },
      });

      res.json(sections);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// ACCOUNT MANAGEMENT
// ============================================

// POST /restaurants/:id/credentials - Generate new login credentials
router.post(
  '/restaurants/:id/credentials',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const restaurant = await prisma.restaurant.findUnique({
        where: { id },
        select: { nameEn: true },
      });

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const username = generateUsername(restaurant.nameEn);
      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);

      const staff = await prisma.restaurantStaff.create({
        data: {
          restaurantId: id,
          username,
          passwordHash,
          displayName: restaurant.nameEn,
        },
      });

      await logAdminAction(prisma, adminUserId, 'generated_credentials', 'restaurant_staff', staff.id, {
        username,
      });

      res.status(201).json({
        credentials: {
          username,
          password,
          staffId: staff.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /restaurants/:id/reset-password - Reset password
router.put(
  '/restaurants/:id/reset-password',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const staff = await prisma.restaurantStaff.findFirst({
        where: { restaurantId: id },
      });

      if (!staff) {
        return res.status(404).json({ error: 'Staff account not found' });
      }

      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);

      const updated = await prisma.restaurantStaff.update({
        where: { id: staff.id },
        data: { passwordHash },
      });

      await logAdminAction(prisma, adminUserId, 'reset_password', 'restaurant_staff', staff.id, {});

      res.json({
        staffId: updated.id,
        password,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /team - List admin team members
router.get('/team', authenticateAdmin, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');

    const admins = await prisma.adminUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(admins);
  } catch (error) {
    next(error);
  }
});

// POST /team - Add admin member
router.post(
  '/team',
  authenticateAdmin,
  [
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('name').notEmpty().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { email, password, name } = req.body;

      const passwordHash = await bcrypt.hash(password, 10);

      const admin = await prisma.adminUser.create({
        data: {
          email,
          passwordHash,
          name,
        },
      });

      await logAdminAction(prisma, adminUserId, 'created_admin', 'admin_user', admin.id, {
        email,
        name,
      });

      res.status(201).json({
        id: admin.id,
        email: admin.email,
        name: admin.name,
        createdAt: admin.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /team/:id - Remove admin member
router.delete(
  '/team/:id',
  authenticateAdmin,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const admin = await prisma.adminUser.findUnique({ where: { id } });
      if (!admin) {
        return res.status(404).json({ error: 'Admin not found' });
      }

      await prisma.adminUser.delete({ where: { id } });

      await logAdminAction(prisma, adminUserId, 'deleted_admin', 'admin_user', id, {
        email: admin.email,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// ANALYTICS
// ============================================

// GET /analytics/overview - Platform analytics overview
router.get('/analytics/overview', authenticateAdmin, async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');

    const totalRestaurants = await prisma.restaurant.count();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(monthStart);

    const completedReservationsThisMonth = await prisma.reservation.findMany({
      where: {
        status: 'COMPLETED',
        updatedAt: { gte: monthStart },
      },
    });

    const completedReservationsLastMonth = await prisma.reservation.findMany({
      where: {
        status: 'COMPLETED',
        updatedAt: { gte: lastMonthStart, lt: lastMonthEnd },
      },
    });

    const totalDinersThisMonth = completedReservationsThisMonth.reduce((sum, r) => sum + r.partySize, 0);
    const totalDinersLastMonth = completedReservationsLastMonth.reduce((sum, r) => sum + r.partySize, 0);

    const growth = totalDinersLastMonth > 0 ? ((totalDinersThisMonth - totalDinersLastMonth) / totalDinersLastMonth) * 100 : 0;

    // Revenue projection (assuming ~$X per diner)
    const revenuePerDiner = 50; // Assumption
    const revenueProjection = totalDinersThisMonth * revenuePerDiner;

    res.json({
      totalRestaurants,
      totalReservationsThisMonth: completedReservationsThisMonth.length,
      totalDinersThisMonth,
      revenueProjection,
      growthPercentage: growth.toFixed(2),
    });
  } catch (error) {
    next(error);
  }
});

// GET /analytics/restaurants/:id - Per-restaurant analytics
router.get(
  '/analytics/restaurants/:id',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const reservations = await prisma.reservation.findMany({
        where: {
          restaurantId: id,
          createdAt: { gte: monthStart },
        },
      });

      const completedReservations = reservations.filter((r) => r.status === 'COMPLETED');
      const totalDiners = completedReservations.reduce((sum, r) => sum + r.partySize, 0);
      const noShowCount = reservations.filter((r) => r.status === 'NO_SHOW').length;
      const appReservations = reservations.filter((r) => r.source === 'APP').length;
      const manualReservations = reservations.filter((r) => r.source === 'MANUAL').length;

      const avgPartySize = completedReservations.length > 0 ? (totalDiners / completedReservations.length).toFixed(2) : 0;

      // Popular time slots
      const timeSlotCounts = {};
      completedReservations.forEach((r) => {
        const hour = r.time.split(':')[0];
        timeSlotCounts[hour] = (timeSlotCounts[hour] || 0) + 1;
      });

      const popularTimeSlots = Object.entries(timeSlotCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([time, count]) => ({ time: `${time}:00`, count }));

      res.json({
        monthReservations: completedReservations.length,
        totalDiners,
        noShowCount,
        appReservations,
        manualReservations,
        avgPartySize,
        popularTimeSlots,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// BILLING
// ============================================

// GET /billing - All billing reports
router.get(
  '/billing',
  authenticateAdmin,
  [query('month').optional().isISO8601()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { month } = req.query;

      const where = {};

      if (month) {
        const monthDate = new Date(month);
        const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
        where.month = { gte: monthDate, lt: nextMonth };
      }

      const reports = await prisma.billingReport.findMany({
        where,
        include: {
          restaurant: {
            select: {
              id: true,
              nameEn: true,
              nameRo: true,
            },
          },
        },
        orderBy: { month: 'desc' },
      });

      res.json(reports);
    } catch (error) {
      next(error);
    }
  }
);

// GET /billing/:restaurantId - Billing for specific restaurant
router.get(
  '/billing/:restaurantId',
  authenticateAdmin,
  [param('restaurantId').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { restaurantId } = req.params;

      const reports = await prisma.billingReport.findMany({
        where: { restaurantId },
        orderBy: { month: 'desc' },
      });

      res.json(reports);
    } catch (error) {
      next(error);
    }
  }
);

// POST /billing/:id/mark-paid - Mark billing as paid
router.post(
  '/billing/:id/mark-paid',
  authenticateAdmin,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id } = req.params;

      const updated = await prisma.billingReport.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
        },
      });

      await logAdminAction(prisma, adminUserId, 'marked_billing_paid', 'billing_report', id, {});

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /billing/:id/export - Export billing as JSON
router.get(
  '/billing/:id/export',
  authenticateAdmin,
  [param('id').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id } = req.params;

      const report = await prisma.billingReport.findUnique({
        where: { id },
        include: {
          restaurant: {
            select: {
              id: true,
              nameEn: true,
              nameRo: true,
              phone: true,
              email: true,
              address: true,
            },
          },
        },
      });

      if (!report) {
        return res.status(404).json({ error: 'Billing report not found' });
      }

      res.json(report);
    } catch (error) {
      next(error);
    }
  }
);

// POST /billing/generate - Generate billing reports for a month
router.post(
  '/billing/generate',
  authenticateAdmin,
  [body('month').isISO8601()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { month } = req.body;

      const monthDate = new Date(month);
      const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
      const prevMonth = new Date(monthDate);

      // Get all completed reservations in this month
      const reservations = await prisma.reservation.findMany({
        where: {
          status: 'COMPLETED',
          updatedAt: { gte: monthDate, lt: nextMonth },
        },
        include: {
          restaurant: true,
        },
      });

      // Group by restaurant and calculate totals
      const restaurantTotals = {};
      reservations.forEach((res) => {
        if (!restaurantTotals[res.restaurantId]) {
          restaurantTotals[res.restaurantId] = 0;
        }
        restaurantTotals[res.restaurantId] += res.partySize;
      });

      // Create or update billing reports
      const reports = [];
      for (const [restaurantId, totalDiners] of Object.entries(restaurantTotals)) {
        const amountOwedRon = (totalDiners * 5).toFixed(2); // $5 per diner example

        const report = await prisma.billingReport.upsert({
          where: {
            restaurantId_month: {
              restaurantId,
              month: monthDate,
            },
          },
          update: {
            totalDiners: parseInt(totalDiners),
            amountOwedRon,
          },
          create: {
            restaurantId,
            month: monthDate,
            totalDiners: parseInt(totalDiners),
            amountOwedRon,
          },
        });

        reports.push(report);
      }

      await logAdminAction(prisma, adminUserId, 'generated_billing', 'billing_report', null, {
        month: monthDate.toISOString(),
        reportsCount: reports.length,
      });

      res.status(201).json(reports);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// AUDIT LOG
// ============================================

// GET /audit-log - Get audit log entries
router.get(
  '/audit-log',
  authenticateAdmin,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const limit = req.query.limit ? parseInt(req.query.limit) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset) : 0;

      const logs = await prisma.adminAuditLog.findMany({
        include: {
          adminUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      const total = await prisma.adminAuditLog.count();

      res.json({
        logs,
        pagination: {
          limit,
          offset,
          total,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
