import { getUser } from '../utils/user.js';
import { getPermissions } from '../utils/permissions.js';

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

    const permissions = await getPermissions(user);

    if (!allowed(user, permissions)) {
      return res.status(403).json({
        success: false,
        message
      });
    }

    req.user = user;
    req.permissions = permissions;
    next();
  } catch (error) {
    console.error('Error in admin middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

export const requirePermission = (permission) => requireRole((user, permissions) => permissions.has(permission), "You don't have permission to do that");

export const requireAnyPermission = (...list) => requireRole((user, permissions) => list.some((permission) => permissions.has(permission)), "You don't have permission to do that");

export const requireSuperadmin = requireRole((user) => user.is_superadmin, 'Superadmin access required');
