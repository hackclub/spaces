import { getUser } from '../utils/user.js';
import { resolveAccess } from '../utils/permissions.js';

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

    const access = await resolveAccess(user, req);

    if (!allowed(access.user, access.permissions, access.grants)) {
      return res.status(403).json({
        success: false,
        message
      });
    }

    req.user = access.user;
    req.permissions = access.permissions;
    req.grants = access.grants;
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

export const requireRoleGranting = requireRole((user, permissions, grants) => user.is_superadmin || grants.length > 0, "You don't have permission to do that");

export const requireSuperadmin = requireRole((user) => user.is_superadmin, 'Superadmin access required');
