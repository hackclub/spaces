import { getUser } from '../utils/user.js';

const requireRole = (allowed, message) => async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || req.cookies?.auth_token || req.body?.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const user = await getUser(authorization);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    if (!allowed(user)) {
      return res.status(403).json({
        success: false,
        message
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error in admin middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

export const requireAdmin = requireRole((user) => user.is_admin || user.is_superadmin, 'Admin access required');

export const requireSuperadmin = requireRole((user) => user.is_superadmin, 'Superadmin access required');
