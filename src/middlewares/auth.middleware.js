import { getUser } from '../utils/user.js';

export const extractAuth = (req, res, next) => {
  req.authToken = req.headers.authorization || req.cookies?.auth_token || null;
  next();
};

export const requireAuth = async (req, res, next) => {
  const authorization = req.headers.authorization || req.cookies?.auth_token;
  
  if (!authorization) {
    return res.status(401).json({
      success: false,
      message: 'Authorization required'
    });
  }
  
  try {
    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }
    
    req.user = user;
    req.authToken = authorization;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};
