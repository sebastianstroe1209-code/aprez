const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { generateToken } = require('../middleware/auth');
const { sendEmail } = require('../services/notifications/channels/email');
const { ROMANIAN_PHONE_RE, PHONE_FORMAT_MSG, phoneFormatErrorBody } = require('../lib/phoneValidation');

const router = express.Router();

// Reset-link target. Override via env when deploying behind a real domain.
const RESTAURANT_FRONTEND_URL = process.env.RESTAURANT_FRONTEND_URL || 'http://localhost:3001';

// Diner reset link — primarily a custom-scheme deep link into the Expo app
// (aprez://reset-password?token=...), with an optional web fallback for
// the case where the diner taps the email on a device without the app
// installed. The web fallback is empty by default (no public diner web
// app exists in MVP); leaving it blank means the email lists the
// `aprez://` link only with a "open from your phone" hint.
const DINER_APP_SCHEME = process.env.DINER_APP_SCHEME || 'aprez';
const DINER_WEB_FALLBACK_URL = process.env.DINER_WEB_FALLBACK_URL || '';

// SPEC §3.3 / §6.8: reset link valid for 1 hour, single-use.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function generateResetToken() {
  // 32 random bytes → 64-hex-char token. Plenty of entropy; URL-safe.
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// USER REGISTRATION
// ============================================
router.post('/register', [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  // SPEC §3.1: phone is optional but must be +40 format (Romanian) when present.
  body('phone').optional({ checkFalsy: true }).trim().matches(ROMANIAN_PHONE_RE).withMessage(PHONE_FORMAT_MSG),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const arr = errors.array();
      // SPEC §3.1: surface a structured error.code for the phone-format
      // failure so the mobile UI can localize it (Tier E/F contract).
      const phoneBody = phoneFormatErrorBody(arr);
      if (phoneBody) return res.status(400).json(phoneBody);
      return res.status(400).json({ error: { message: arr[0].msg } });
    }

    const prisma = req.app.get('prisma');
    const { firstName, lastName, phone, email, password } = req.body;

    // Must provide phone or email
    if (!phone && !email) {
      return res.status(400).json({ error: { message: 'Phone number or email is required' } });
    }

    // Check if user already exists
    if (phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) {
        return res.status(409).json({ error: { message: 'Phone number already registered' } });
      }
    }
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: { message: 'Email already registered' } });
      }
    }

    // Hash password if provided (for email registration)
    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        passwordHash,
      },
    });

    // If phone provided, send OTP (placeholder for Twilio integration)
    if (phone) {
      // TODO: Send OTP via Twilio
      console.log(`[DEV] OTP for ${phone}: 123456`);
    }

    const token = generateToken({ id: user.id, role: 'user' });

    res.status(201).json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        phoneVerified: user.phoneVerified,
        preferredLanguage: user.preferredLanguage,
      },
      token,
      message: phone ? 'Account created. Please verify your phone number.' : 'Account created successfully.',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// USER LOGIN (Email + Password)
// ============================================
router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const token = generateToken({ id: user.id, role: 'user' });

    res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        phoneVerified: user.phoneVerified,
        preferredLanguage: user.preferredLanguage,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// RESTAURANT STAFF LOGIN
// ============================================
router.post('/restaurant/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }

    const prisma = req.app.get('prisma');
    const { username, password } = req.body;

    const staff = await prisma.restaurantStaff.findUnique({
      where: { username },
      include: { restaurant: true },
    });

    if (!staff) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const valid = await bcrypt.compare(password, staff.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    if (!staff.restaurant.isActive) {
      return res.status(403).json({ error: { message: 'This restaurant has been deactivated' } });
    }

    const token = generateToken({
      id: staff.id,
      restaurantId: staff.restaurantId,
      role: 'restaurant',
    });

    res.json({
      staff: {
        id: staff.id,
        displayName: staff.displayName,
        restaurantId: staff.restaurantId,
        restaurantName: staff.restaurant.nameEn,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// RESTAURANT STAFF FORGOT-PASSWORD (Tier D commit 1, SPEC §6.8)
// Single-use email-delivered reset token, 1-hour TTL. Response is
// always 200 with a neutral message — don't leak whether the username
// exists. The actual email recipient is RestaurantStaff.email (admin-
// set per §6.8) with a fallback to the restaurant's contact email.
// ============================================
router.post('/restaurant/forgot-password', [
  body('usernameOrEmail').trim().notEmpty().withMessage('Username or email is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }
    const prisma = req.app.get('prisma');
    const { usernameOrEmail } = req.body;

    // Always-200 success copy. Computed up front so every code path below
    // returns the same string and timing characteristics are similar.
    const neutralResponse = {
      message: 'If an account exists, we have sent a reset link to the email on file.',
    };

    const staff = await prisma.restaurantStaff.findFirst({
      where: {
        OR: [
          { username: usernameOrEmail },
          { email: usernameOrEmail },
        ],
      },
      include: { restaurant: { select: { email: true, isActive: true, nameEn: true } } },
    });

    if (!staff || !staff.restaurant.isActive) {
      // Match the neutral response shape so an attacker can't tell from
      // the wire whether the username existed.
      return res.json(neutralResponse);
    }

    const recipient = staff.email || staff.restaurant.email;
    if (!recipient) {
      console.warn(`[auth] forgot-password requested for staff ${staff.id} but no email on file (staff.email + restaurant.email both null); skipping send.`);
      return res.json(neutralResponse);
    }

    // Invalidate any prior outstanding tokens for this staff so the link
    // they receive is the only valid one. Avoids the case where an old
    // unused token is still active when a new one is issued.
    await prisma.passwordResetToken.updateMany({
      where: { userId: staff.id, userType: 'restaurant', usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: staff.id,
        userType: 'restaurant',
        token,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetLink = `${RESTAURANT_FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail(prisma, null, {
      to: recipient,
      subject: `Reset your password — ${staff.restaurant.nameEn}`,
      text:
        `Hi ${staff.displayName || staff.username},\n\n` +
        `A password reset was requested for your ${staff.restaurant.nameEn} staff account on ApRez.\n\n` +
        `Click the link below to set a new password. The link is valid for 1 hour and can only be used once.\n\n` +
        `${resetLink}\n\n` +
        `If you didn't request this, you can safely ignore this email — your password won't change.\n\n` +
        `— ApRez`,
      html:
        `<p>Hi ${staff.displayName || staff.username},</p>` +
        `<p>A password reset was requested for your <strong>${staff.restaurant.nameEn}</strong> staff account on ApRez.</p>` +
        `<p><a href="${resetLink}" style="display:inline-block;padding:10px 16px;background:#22c55e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Reset your password</a></p>` +
        `<p>Or copy this link into your browser: <code>${resetLink}</code></p>` +
        `<p>The link is valid for 1 hour and can only be used once.</p>` +
        `<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>` +
        `<p>— ApRez</p>`,
    });

    res.json(neutralResponse);
  } catch (error) {
    next(error);
  }
});

// ============================================
// RESTAURANT STAFF RESET-PASSWORD (Tier D commit 1)
// Validates the token (not expired, not used) and updates the staff
// row's passwordHash. Returns 400 with a specific code for expired /
// invalid / used tokens so the frontend can show the right copy.
// ============================================
router.post('/restaurant/reset-password', [
  body('token').trim().notEmpty().withMessage('Token is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }
    const prisma = req.app.get('prisma');
    const { token, newPassword } = req.body;

    const row = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!row || row.userType !== 'restaurant') {
      return res.status(400).json({ error: { code: 'invalid-token', message: 'Invalid or unknown reset token.' } });
    }
    if (row.usedAt) {
      return res.status(400).json({ error: { code: 'token-used', message: 'This reset link has already been used.' } });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: { code: 'token-expired', message: 'This reset link has expired. Request a new one.' } });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Mark token used + update password in a single transaction so a
    // mid-flight crash can't leave the token usable.
    await prisma.$transaction([
      prisma.restaurantStaff.update({
        where: { id: row.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ message: 'Password updated. You can now log in.' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DINER FORGOT-PASSWORD (Tier D commit 2, SPEC §3.3)
// Same shape as the restaurant flow but addressed to User.email and
// delivered via an aprez:// deep link rather than a web URL. Neutral 200
// regardless of whether the email exists. We skip the send if the matched
// user has no password set (i.e. registered phone-only) or is soft-deleted.
// ============================================
router.post('/diner/forgot-password', [
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }
    const prisma = req.app.get('prisma');
    const email = req.body.email.toLowerCase();

    const neutralResponse = {
      message: 'If an account exists, we have sent a reset link to that email.',
    };

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, firstName: true, email: true, passwordHash: true, deletedAt: true, preferredLanguage: true },
    });

    // Bail with the neutral response if: not found, soft-deleted, or
    // phone-only (no passwordHash to reset). Match wire-shape exactly.
    if (!user || user.deletedAt || !user.passwordHash) {
      return res.json(neutralResponse);
    }

    // Invalidate any prior outstanding tokens for this diner so only the
    // freshly-issued link works.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, userType: 'user', usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        userType: 'user',
        token,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const deepLink = `${DINER_APP_SCHEME}://reset-password?token=${encodeURIComponent(token)}`;
    const webLink = DINER_WEB_FALLBACK_URL
      ? `${DINER_WEB_FALLBACK_URL.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`
      : null;
    const greeting = user.firstName || 'there';

    await sendEmail(prisma, null, {
      to: user.email,
      subject: 'Reset your ApRez password',
      text:
        `Hi ${greeting},\n\n` +
        `A password reset was requested for your ApRez account.\n\n` +
        `Open this link on your phone to set a new password (valid for 1 hour, single-use):\n` +
        `${deepLink}\n\n` +
        (webLink ? `If the link above doesn't open the app, try the web link:\n${webLink}\n\n` : '') +
        `If you didn't request this, you can safely ignore this email — your password won't change.\n\n` +
        `— ApRez`,
      html:
        `<p>Hi ${greeting},</p>` +
        `<p>A password reset was requested for your ApRez account.</p>` +
        `<p><a href="${deepLink}" style="display:inline-block;padding:10px 16px;background:#22c55e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Reset your password</a></p>` +
        `<p>Open this link on your phone to set a new password (valid for 1 hour, single-use). If it doesn't open the app:</p>` +
        `<p><code>${deepLink}</code></p>` +
        (webLink ? `<p>Web fallback: <a href="${webLink}">${webLink}</a></p>` : '') +
        `<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>` +
        `<p>— ApRez</p>`,
    });

    res.json(neutralResponse);
  } catch (error) {
    next(error);
  }
});

// ============================================
// DINER RESET-PASSWORD (Tier D commit 2)
// Mirror of the restaurant-side endpoint, scoped to userType='user' so a
// staff token can't be redeemed via the diner endpoint and vice versa.
// ============================================
router.post('/diner/reset-password', [
  body('token').trim().notEmpty().withMessage('Token is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }
    const prisma = req.app.get('prisma');
    const { token, newPassword } = req.body;

    const row = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!row || row.userType !== 'user') {
      return res.status(400).json({ error: { code: 'invalid-token', message: 'Invalid or unknown reset token.' } });
    }
    if (row.usedAt) {
      return res.status(400).json({ error: { code: 'token-used', message: 'This reset link has already been used.' } });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: { code: 'token-expired', message: 'This reset link has expired. Request a new one.' } });
    }

    // Belt-and-braces: if the target diner was deleted between request and
    // redemption, treat the token as invalid rather than 500ing on a
    // foreign-key write to a missing/soft-deleted row.
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      return res.status(400).json({ error: { code: 'invalid-token', message: 'Invalid or unknown reset token.' } });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ message: 'Password updated. You can now log in.' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADMIN LOGIN
// ============================================
router.post('/admin/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }

    const prisma = req.app.get('prisma');
    const { email, password } = req.body;

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const token = generateToken({ id: admin.id, role: 'admin' });

    res.json({
      admin: { id: admin.id, name: admin.name, email: admin.email },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// REFRESH TOKEN
// ============================================
router.post('/refresh', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Token required' } });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');

    // Verify even if expired (to get the payload)
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });

    // Generate new token
    const newToken = generateToken({
      id: decoded.id,
      role: decoded.role,
      ...(decoded.restaurantId && { restaurantId: decoded.restaurantId }),
    });

    res.json({ token: newToken });
  } catch (error) {
    return res.status(401).json({ error: { message: 'Invalid token' } });
  }
});

module.exports = router;
