// Tier F commit 1 — shared upload infrastructure.
//
// Storage layout (relative to UPLOADS_DIR):
//   {restaurantId}/photos/{photoId}.{ext}
//   {restaurantId}/menu.pdf
//
// Production (Railway): UPLOADS_DIR=/var/aprez-uploads on a mounted
// volume — Railway docs §Volumes — so data survives container restarts.
// Local dev: defaults to <repo>/server/uploads, which is git-ignored.
// Static-served by Express at /uploads (see server/src/index.js), so the
// DB stores public paths like `/uploads/{rid}/photos/{photoId}.jpg`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// Make sure the root exists at boot. Per-restaurant subdirs are created
// on demand inside the multer destination handler.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PHOTO_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const PHOTO_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png' };
const PDF_MIME = 'application/pdf';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;   // 5 MB — SPEC §7.1
const MAX_MENU_BYTES  = 10 * 1024 * 1024;  // 10 MB — SPEC §7.1
const MAX_PHOTOS_PER_RESTAURANT = 10;      // SPEC §7.1

function restaurantDir(restaurantId) {
  return path.join(UPLOADS_DIR, restaurantId);
}
function photosDir(restaurantId) {
  return path.join(restaurantDir(restaurantId), 'photos');
}
function menuPath(restaurantId) {
  return path.join(restaurantDir(restaurantId), 'menu.pdf');
}

function publicPhotoUrl(restaurantId, fileBase) {
  return `/uploads/${restaurantId}/photos/${fileBase}`;
}
function publicMenuUrl(restaurantId) {
  return `/uploads/${restaurantId}/menu.pdf`;
}

// Resolve the restaurant id the upload belongs to. Admin routes carry it
// as the `:id` path param; staff routes (where it would be a tenancy hole
// to trust a path/body value) set `req.uploadRestaurantId` from the JWT
// via a middleware before the multer chain runs.
function uploadRestaurantId(req) {
  return req.uploadRestaurantId || req.params.id;
}

// Multer photo uploader. Generates a UUID-based filename so two
// concurrently-uploaded photos with the same original name don't collide,
// and so the public URL is opaque (don't leak the diner's filename).
const photoUploader = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const dir = photosDir(uploadRestaurantId(req));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (_req, file, cb) => {
      const ext = PHOTO_EXT[file.mimetype] || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!PHOTO_MIME.has(file.mimetype)) {
      // Surface a stable error code the route handler can translate to
      // a friendly 400 response (multer otherwise wraps generic errors).
      const err = new Error('Only JPG and PNG files are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  },
});

// Menu uploader — same shape, but PDF-only and the destination filename
// is always `menu.pdf` (overwrites the previous file in-place per SPEC
// §7.1; one menu per restaurant).
const menuUploader = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const dir = restaurantDir(uploadRestaurantId(req));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (_req, _file, cb) => cb(null, 'menu.pdf'),
  }),
  limits: { fileSize: MAX_MENU_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== PDF_MIME) {
      const err = new Error('Only PDF files are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  },
});

// Convert multer errors into JSON 400s with a stable error.code. Mount
// in the route handler chain after the multer middleware. Without this
// wrapper multer's MulterError surfaces as a generic 500 by default.
function handleUploadError(err, _req, res, _next) {
  if (!err) return _next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'file-too-large', message: 'File exceeds the size limit.' } });
  }
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: { code: 'invalid-file-type', message: err.message } });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: { code: err.code || 'upload-error', message: err.message } });
  }
  return _next(err);
}

// Safe delete — used by DELETE photo/menu endpoints. Swallows ENOENT
// (already-deleted file is fine; the DB row is the source of truth).
function safeUnlink(absPath) {
  try {
    fs.unlinkSync(absPath);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[uploads] unlink failed for ${absPath}:`, e.message);
    }
  }
}

module.exports = {
  UPLOADS_DIR,
  MAX_PHOTOS_PER_RESTAURANT,
  photoUploader,
  menuUploader,
  handleUploadError,
  photosDir,
  menuPath,
  publicPhotoUrl,
  publicMenuUrl,
  safeUnlink,
};
