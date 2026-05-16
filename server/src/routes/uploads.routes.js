// Tier F commit 1 — admin upload routes for restaurant photos + menu PDF.
//
// All endpoints are admin-only (require an `admin` role JWT). Mounted at
// /api/admin (so the full paths are /api/admin/restaurants/:id/photos
// etc.) so they sit alongside the rest of the admin surface.
//
// File storage convention + multer config live in `lib/uploads.js`.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateAdmin } = require('../middleware/auth');
const {
  photoUploader,
  menuUploader,
  handleUploadError,
  photosDir,
  menuPath,
  publicPhotoUrl,
  publicMenuUrl,
  safeUnlink,
  MAX_PHOTOS_PER_RESTAURANT,
} = require('../lib/uploads');

const router = express.Router();

// All upload endpoints require admin auth. Diner-side reads are
// served by Express static at /uploads with no auth (photos + menus are
// public-by-design — a logged-out diner browsing the home list still
// sees cover photos).
router.use(authenticateAdmin);

// --------------------------------------------------------------
// POST /restaurants/:id/photos — upload a single photo.
// Body: multipart/form-data; field name = "photo".
// Returns the new RestaurantPhoto row.
// --------------------------------------------------------------
router.post(
  '/restaurants/:id/photos',
  photoUploader.single('photo'),
  handleUploadError,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id: restaurantId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: { code: 'no-file', message: 'No photo uploaded.' } });
      }

      // Restaurant must exist. multer has already written the file to
      // disk at this point — clean up if the FK would fail.
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true },
      });
      if (!restaurant) {
        safeUnlink(file.path);
        return res.status(404).json({ error: { code: 'restaurant-not-found', message: 'Restaurant not found.' } });
      }

      // Cap at 10 photos per restaurant (SPEC §7.1). Counted before insert
      // so we don't write a row we'd immediately have to delete.
      const existingCount = await prisma.restaurantPhoto.count({ where: { restaurantId } });
      if (existingCount >= MAX_PHOTOS_PER_RESTAURANT) {
        safeUnlink(file.path);
        return res.status(400).json({
          error: { code: 'photo-limit-reached', message: `Maximum ${MAX_PHOTOS_PER_RESTAURANT} photos per restaurant.` },
        });
      }

      const photo = await prisma.restaurantPhoto.create({
        data: {
          restaurantId,
          photoUrl: publicPhotoUrl(restaurantId, file.filename),
          displayOrder: existingCount,
        },
      });

      res.status(201).json(photo);
    } catch (e) {
      // If we crashed mid-write, leave the on-disk file alone — the
      // admin can re-upload or DELETE manually. Logging makes the
      // orphan discoverable.
      if (req.file?.path) {
        console.warn(`[uploads] photo POST failed after multer wrote ${req.file.path}:`, e.message);
      }
      next(e);
    }
  }
);

// --------------------------------------------------------------
// DELETE /restaurants/:id/photos/:photoId
// Removes the DB row + the file on disk. If the deleted photo was
// the current cover, also clears Restaurant.coverPhotoUrl.
// --------------------------------------------------------------
router.delete('/restaurants/:id/photos/:photoId', async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const { id: restaurantId, photoId } = req.params;

    const photo = await prisma.restaurantPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.restaurantId !== restaurantId) {
      return res.status(404).json({ error: { code: 'photo-not-found', message: 'Photo not found.' } });
    }

    // Filename is the last path segment of the stored public URL.
    const filename = path.basename(photo.photoUrl);

    // Atomic: delete row + clear cover-url denormalization in one txn,
    // then unlink the file (file system, not in transaction).
    const wasCover = photo.isCover;
    await prisma.$transaction([
      prisma.restaurantPhoto.delete({ where: { id: photoId } }),
      ...(wasCover
        ? [prisma.restaurant.update({ where: { id: restaurantId }, data: { coverPhotoUrl: null } })]
        : []),
    ]);

    safeUnlink(path.join(photosDir(restaurantId), filename));

    res.json({ message: 'Photo deleted.', wasCover });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------
// PUT /restaurants/:id/photos/:photoId/cover
// Marks the target photo isCover=true, clears the flag on any prior
// cover, and updates the denormalized Restaurant.coverPhotoUrl.
// --------------------------------------------------------------
router.put('/restaurants/:id/photos/:photoId/cover', async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const { id: restaurantId, photoId } = req.params;

    const photo = await prisma.restaurantPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.restaurantId !== restaurantId) {
      return res.status(404).json({ error: { code: 'photo-not-found', message: 'Photo not found.' } });
    }

    await prisma.$transaction([
      // Clear any previous cover flag in this restaurant.
      prisma.restaurantPhoto.updateMany({
        where: { restaurantId, isCover: true, id: { not: photoId } },
        data: { isCover: false },
      }),
      // Set the new cover.
      prisma.restaurantPhoto.update({
        where: { id: photoId },
        data: { isCover: true },
      }),
      // Keep the denormalized URL in sync so the diner GET path doesn't
      // have to join.
      prisma.restaurant.update({
        where: { id: restaurantId },
        data: { coverPhotoUrl: photo.photoUrl },
      }),
    ]);

    res.json({ message: 'Cover updated.', photoId, coverPhotoUrl: photo.photoUrl });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------
// POST /restaurants/:id/menu — upload (or replace) the menu PDF.
// Body: multipart/form-data; field name = "menu".
// --------------------------------------------------------------
router.post(
  '/restaurants/:id/menu',
  menuUploader.single('menu'),
  handleUploadError,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const { id: restaurantId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: { code: 'no-file', message: 'No menu PDF uploaded.' } });
      }

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true },
      });
      if (!restaurant) {
        safeUnlink(file.path);
        return res.status(404).json({ error: { code: 'restaurant-not-found', message: 'Restaurant not found.' } });
      }

      const url = publicMenuUrl(restaurantId);
      const updated = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { menuPdfUrl: url },
        select: { id: true, menuPdfUrl: true },
      });

      res.status(201).json(updated);
    } catch (e) {
      if (req.file?.path) {
        console.warn(`[uploads] menu POST failed after multer wrote ${req.file.path}:`, e.message);
      }
      next(e);
    }
  }
);

// --------------------------------------------------------------
// DELETE /restaurants/:id/menu — removes the file + clears menuPdfUrl.
// --------------------------------------------------------------
router.delete('/restaurants/:id/menu', async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const { id: restaurantId } = req.params;

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, menuPdfUrl: true },
    });
    if (!restaurant) {
      return res.status(404).json({ error: { code: 'restaurant-not-found', message: 'Restaurant not found.' } });
    }

    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { menuPdfUrl: null },
    });

    safeUnlink(menuPath(restaurantId));

    res.json({ message: 'Menu deleted.' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
