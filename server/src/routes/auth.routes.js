const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// ============================================
// USER REGISTRATION
// ============================================
router.post('/register', [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('phone').optional().trim(),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
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
// SEND OTP (Phone Verification)
// ============================================
router.post('/send-otp', [
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }

    const { phone } = req.body;

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP temporarily (in production, use Redis with TTL)
    // For now, store in memory with 5-minute expiry
    if (!global.otpStore) global.otpStore = {};
    global.otpStore[phone] = {
      code: otp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    // TODO: Send via Twilio
    console.log(`[DEV] OTP for ${phone}: ${otp}`);

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// VERIFY OTP
// ============================================
router.post('/verify-otp', [
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('code').trim().notEmpty().withMessage('OTP code is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: { message: errors.array()[0].msg } });
    }

    const prisma = req.app.get('prisma');
    const { phone, code } = req.body;

    // Check OTP
    const stored = global.otpStore?.[phone];
    if (!stored || stored.expiresAt < Date.now()) {
      return res.status(400).json({ error: { message: 'OTP expired or not found. Request a new one.' } });
    }
    if (stored.code !== code) {
      return res.status(400).json({ error: { message: 'Invalid OTP code' } });
    }

    // Clear OTP
    delete global.otpStore[phone];

    // Mark phone as verified and get/create user
    let user = await prisma.user.findUnique({ where: { phone } });

    if (user) {
      // Existing user — mark as verified
      user = await prisma.user.update({
        where: { phone },
        data: { phoneVerified: true },
      });
    }

    if (!user) {
      return res.status(404).json({ error: { message: 'User not found. Please register first.' } });
    }

    const token = generateToken({ id: user.id, role: 'user' });

    res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        phoneVerified: true,
        preferredLanguage: user.preferredLanguage,
      },
      token,
      message: 'Phone verified successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// USER LOGIN (Email + Password)
// ============================================
router.post('/login', [
  body('email').optional().isEmail(),
  body('phone').optional().trim(),
  body('password').optional(),
], async (req, res, next) => {
  try {
    const prisma = req.app.get('prisma');
    const { email, phone, password } = req.body;

    let user;
    if (email) {
      user = await prisma.user.findUnique({ where: { email } });
    } else if (phone) {
      user = await prisma.user.findUnique({ where: { phone } });
      if (user) {
        // Phone login — send OTP instead of password
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        if (!global.otpStore) global.otpStore = {};
        global.otpStore[phone] = {
          code: otp,
          expiresAt: Date.now() + 5 * 60 * 1000,
        };
        console.log(`[DEV] Login OTP for ${phone}: ${otp}`);
        return res.json({ message: 'OTP sent to your phone. Use /verify-otp to complete login.' });
      }
    }

    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    // Email login requires password
    if (email && password) {
      if (!user.passwordHash) {
        return res.status(401).json({ error: { message: 'This account uses phone login. Please use OTP.' } });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: { message: 'Invalid credentials' } });
      }
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
