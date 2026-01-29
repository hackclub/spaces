import pg from '../utils/db.js';
import { getUser } from '../utils/user.js';

export const requireAdmin = async (req, res, next) => {
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

    if (!user.is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
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
