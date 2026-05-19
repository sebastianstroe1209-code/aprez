// Tier G commit 3 — staff-side upload routes for restaurant photos +
// menu PDF (SPEC §6.7). Staff equivalents of the Tier F1 admin endpoints
// in uploads.routes.js (Option A — duplicate endpoints, not re-keyed
// admin ones).
//
// Mounted at /api/restaurant, so the full paths are /api/restaurant/photos
// etc. restaurantId is ALWAYS derived from the JWT (req.user.restaurantId)
// — never a path or body parameter — so staff can only ever act on their
// own restaurant. Photo delete/cover additionally verify ownership of the
// targeted photoId and return 403 on a cross-tenant attempt.
//
// All multer config, file-type/size validation and path conventions are
// single-sourced in lib/uploads.js (shared with the admin routes).

const express = require('express');
const path = require('path');
const { authenticateRestaurant } = require('../middleware/auth');
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

router.use(authenticateRestaurant);

// multer's destination handler runs before the route body — it reads
// req.uploadRestaurantId. Set it from the JWT so the file lands in the
// staff member's own restaurant directory.
function setUploadRestaurantId(req, _res, next) {
  req.uploadRestaurantId = req.user.restaurantId;
  next();
}

// --------------------------------------------------------------
// POST /photos — upload a single photo. Field name = "photo".
// --------------------------------------------------------------
router.post(
  '/photos',
  setUploadRestaurantId,
  photoUploader.single('photo'),
  handleUploadError,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: { code: 'no-file', message: 'No photo uploaded.' } });
      }

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
      if (req.file?.path) {
        console.warn(`[uploads] staff photo POST failed after multer wrote ${req.file.path}:`, e.message);
      }
      next(e);
    }
  }
);

// --------------------------------------------------------------
// DELETE /photos/:photoId
// --------------------------------------------------------------
router.delete('/photos/:photoId', async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;
    const { photoId } = req.params;

    const photo = await prisma.restaurantPhoto.findUnique({ where: { id: photoId } });
    if (!photo) {
      return res.status(404).json({ error: { code: 'photo-not-found', message: 'Photo not found.' } });
    }
    if (photo.restaurantId !== restaurantId) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'This photo belongs to another restaurant.' } });
    }

    const filename = path.basename(photo.photoUrl);
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
// PUT /photos/:photoId/cover
// --------------------------------------------------------------
router.put('/photos/:photoId/cover', async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;
    const { photoId } = req.params;

    const photo = await prisma.restaurantPhoto.findUnique({ where: { id: photoId } });
    if (!photo) {
      return res.status(404).json({ error: { code: 'photo-not-found', message: 'Photo not found.' } });
    }
    if (photo.restaurantId !== restaurantId) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'This photo belongs to another restaurant.' } });
    }

    await prisma.$transaction([
      prisma.restaurantPhoto.updateMany({
        where: { restaurantId, isCover: true, id: { not: photoId } },
        data: { isCover: false },
      }),
      prisma.restaurantPhoto.update({ where: { id: photoId }, data: { isCover: true } }),
      prisma.restaurant.update({ where: { id: restaurantId }, data: { coverPhotoUrl: photo.photoUrl } }),
    ]);

    res.json({ message: 'Cover updated.', photoId, coverPhotoUrl: photo.photoUrl });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------
// POST /menu — upload (or replace) the menu PDF. Field name = "menu".
// --------------------------------------------------------------
router.post(
  '/menu',
  setUploadRestaurantId,
  menuUploader.single('menu'),
  handleUploadError,
  async (req, res, next) => {
    try {
      const prisma = req.app.get('prisma');
      const restaurantId = req.user.restaurantId;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: { code: 'no-file', message: 'No menu PDF uploaded.' } });
      }

      const updated = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { menuPdfUrl: publicMenuUrl(restaurantId) },
        select: { id: true, menuPdfUrl: true },
      });

      res.status(201).json(updated);
    } catch (e) {
      if (req.file?.path) {
        console.warn(`[uploads] staff menu POST failed after multer wrote ${req.file.path}:`, e.message);
      }
      next(e);
    }
  }
);

// --------------------------------------------------------------
// DELETE /menu
// --------------------------------------------------------------
router.delete('/menu', async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const restaurantId = req.user.restaurantId;

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
