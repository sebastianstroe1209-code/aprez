const jwt = require('jsonwebtoken');

// Verify JWT token and attach user to request
const authenticate = (requiredRole = null) => {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: { message: 'Authentication required' } });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check role if required
      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: { message: 'Insufficient permissions' } });
      }

      // GDPR §5.9 — diner JWTs become invalid the moment the user soft-
      // deletes the account via DELETE /api/users/me. The DB lookup is
      // scoped to role='user' so restaurant/admin requests stay zero-cost.
      // Token-invalidation matters here because JWTs are valid for 7 days;
      // without this check a stolen token would survive deletion.
      if (decoded.role === 'user') {
        const prisma = req.app.get('prisma');
        if (prisma) {
          const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { deletedAt: true },
          });
          if (!user || user.deletedAt) {
            return res.status(401).json({ error: { code: 'account-deleted', message: 'Account no longer exists.' } });
          }
        }
      }

      req.user = decoded;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: { message: 'Token expired' } });
      }
      return res.status(401).json({ error: { message: 'Invalid token' } });
    }
  };
};

// Shorthand middleware for specific roles
const authenticateUser = authenticate('user');
const authenticateRestaurant = authenticate('restaurant');
const authenticateAdmin = authenticate('admin');

// Generate JWT token
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

module.exports = {
  authenticate,
  authenticateUser,
  authenticateRestaurant,
  authenticateAdmin,
  generateToken,
};
