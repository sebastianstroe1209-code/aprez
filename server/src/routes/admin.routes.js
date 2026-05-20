const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../middleware/auth');
const { applyOpeningHours, applyServicePeriods } = require('../lib/restaurantProfile');

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
          // Tier F commit 1 — photos are now part of the admin
          // restaurant payload so the Photos section in the edit page
          // doesn't have to do a second round-trip.
          photos: {
            orderBy: { displayOrder: 'asc' },
          },
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

      // Opening hours + service periods (delete + recreate). Shared with
      // the staff PUT /api/restaurant/settings endpoint so the two can't drift.
      await applyOpeningHours(prisma, id, req.body.openingHours);
      await applyServicePeriods(prisma, id, req.body.servicePeriods);

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
// RESERVATION-DISABLED DAYS (Tier F commit 2, SPEC §7.1)
// Per-restaurant calendar of specific dates that block new reservations.
// Backed by the existing `DisabledDate` model — the spec called the new
// table `ReservationDisabledDate` but the same shape already shipped in
// Tier B with the shorter name; we reuse it rather than duplicate.
// Diner-side enforcement was already wired in reservation.routes.js +
// restaurant.routes.js time-slots — these admin endpoints fill in CRUD.
// ============================================

// GET /restaurants/:id/disabled-dates - List, sorted asc.
router.get(
  '/restaurants/:id/disabled-dates',
  authenticateAdmin,
  [param('id').notEmpty().trim()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const rows = await prisma.disabledDate.findMany({
        where: { restaurantId: req.params.id },
        orderBy: { date: 'asc' },
      });
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// POST /restaurants/:id/disabled-dates  body { date: 'YYYY-MM-DD', reason? }
router.post(
  '/restaurants/:id/disabled-dates',
  authenticateAdmin,
  [
    param('id').notEmpty().trim(),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD'),
    body('reason').optional({ checkFalsy: true }).isString().isLength({ max: 200 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const restaurantId = req.params.id;
      const { date, reason } = req.body;

      // Reject past dates. Compare ISO-date strings in UTC so we avoid
      // a borderline TZ slip — disabling "today" should always be valid
      // regardless of local hour.
      const todayIso = new Date().toISOString().slice(0, 10);
      if (date < todayIso) {
        return res.status(400).json({ error: { code: 'date-in-past', message: 'Date must be today or in the future.' } });
      }

      const dateObj = new Date(`${date}T00:00:00.000Z`);

      // Restaurant must exist.
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true },
      });
      if (!restaurant) {
        return res.status(404).json({ error: { code: 'restaurant-not-found', message: 'Restaurant not found.' } });
      }

      // Conflict on existing (relies on the @@unique([restaurantId, date])
      // constraint that's been on DisabledDate since Tier B; pre-check
      // gives a friendlier error than a Prisma P2002.
      const existing = await prisma.disabledDate.findFirst({
        where: { restaurantId, date: dateObj },
      });
      if (existing) {
        return res.status(400).json({ error: { code: 'already-exists', message: 'This date is already disabled.' } });
      }

      const created = await prisma.disabledDate.create({
        data: {
          restaurantId,
          date: dateObj,
          reason: reason || null,
        },
      });

      await logAdminAction(prisma, adminUserId, 'added_disabled_date', 'restaurant', restaurantId, { date, reason: reason || null });

      res.status(201).json(created);
    } catch (e) { next(e); }
  }
);

// DELETE /restaurants/:id/disabled-dates/:dateId
router.delete(
  '/restaurants/:id/disabled-dates/:dateId',
  authenticateAdmin,
  [param('id').notEmpty().trim(), param('dateId').isUUID()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const adminUserId = req.user.id;
      const { id: restaurantId, dateId } = req.params;

      const row = await prisma.disabledDate.findUnique({ where: { id: dateId } });
      if (!row || row.restaurantId !== restaurantId) {
        return res.status(404).json({ error: { code: 'disabled-date-not-found', message: 'Disabled date not found.' } });
      }

      await prisma.disabledDate.delete({ where: { id: dateId } });
      await logAdminAction(prisma, adminUserId, 'removed_disabled_date', 'restaurant', restaurantId, { date: row.date });

      res.json({ message: 'Disabled date removed.' });
    } catch (e) { next(e); }
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
// Tier F commit 2: when gridRows/gridColumns shrink, refuse with 409
// `shrink-orphans-tables` if any table would end up outside the new
// dimensions. Without this guard the table rows survive but the grid
// editor renders them off-canvas — a silent data-integrity hazard.
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

      // Pre-validate shrink against current tables before mutating.
      if (updateData.gridRows !== undefined || updateData.gridColumns !== undefined) {
        const current = await prisma.tableSection.findUnique({
          where: { id },
          include: { tables: { select: { id: true, tableNumber: true, gridRow: true, gridCol: true } } },
        });
        if (!current) {
          return res.status(404).json({ error: { code: 'section-not-found', message: 'Section not found.' } });
        }
        const newRows = updateData.gridRows ?? current.gridRows;
        const newCols = updateData.gridColumns ?? current.gridColumns;
        const orphans = (current.tables || []).filter(
          (t) => t.gridRow >= newRows || t.gridCol >= newCols
        );
        if (orphans.length > 0) {
          return res.status(409).json({
            error: {
              code: 'shrink-orphans-tables',
              message: `Cannot shrink: ${orphans.length} table(s) would fall outside the new grid.`,
              orphanCount: orphans.length,
              // Cap to keep the payload small; UI just needs a few names.
              sampleTables: orphans.slice(0, 5).map((t) => ({
                id: t.id,
                tableNumber: t.tableNumber,
                gridRow: t.gridRow,
                gridCol: t.gridCol,
              })),
              newRows,
              newCols,
            },
          });
        }
      }

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
// Tier F commit 2 guards: 409 if any FUTURE reservation is attached to a
// table in this section. If only PAST reservations exist, null-out their
// tableId in the same transaction (preserves diner history) then cascade-
// delete the section + tables. Without this, the cascade either bombs
// on the FK from Reservation → RestaurantTable, or silently nukes the
// restaurant's billing-relevant past bookings.
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

      const section = await prisma.tableSection.findUnique({
        where: { id },
        include: { tables: { select: { id: true } } },
      });
      if (!section) {
        return res.status(404).json({ error: { code: 'section-not-found', message: 'Section not found.' } });
      }

      const tableIds = (section.tables || []).map((t) => t.id);
      if (tableIds.length > 0) {
        // Compare dates at midnight UTC; matches how reservation dates
        // are stored (Date column, no time component on the date field).
        const todayMidnight = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

        const futureCount = await prisma.reservation.count({
          where: {
            tableId: { in: tableIds },
            date: { gte: todayMidnight },
            // Don't count already-cancelled bookings — they don't
            // "occupy" the table for the purposes of this guard.
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
        });
        if (futureCount > 0) {
          const next = await prisma.reservation.findFirst({
            where: {
              tableId: { in: tableIds },
              date: { gte: todayMidnight },
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            },
            orderBy: [{ date: 'asc' }, { time: 'asc' }],
            select: { date: true, time: true },
          });
          return res.status(409).json({
            error: {
              code: 'section-has-reservations',
              message: `This section has ${futureCount} future reservation(s) attached. Cancel or reassign them before deleting the section.`,
              count: futureCount,
              nextDate: next?.date,
              nextTime: next?.time,
            },
          });
        }

        // Past-only attached: null-out their tableId in a transaction so
        // the cascade doesn't FK-fail and the audit row stays intact.
        const pastCount = await prisma.reservation.count({
          where: { tableId: { in: tableIds } },
        });
        if (pastCount > 0) {
          await prisma.reservation.updateMany({
            where: { tableId: { in: tableIds } },
            data: { tableId: null },
          });
        }
      }

      // Cascade-delete (TableSection has onDelete: Cascade on tables).
      await prisma.tableSection.delete({ where: { id } });

      await logAdminAction(prisma, adminUserId, 'deleted_section', 'table_section', id, {
        tablesRemoved: tableIds.length,
      });

      res.json({ message: 'Section deleted.', tablesRemoved: tableIds.length });
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
