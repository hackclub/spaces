import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const normaliseIp = typeof ipKeyGenerator === 'function' ? ipKeyGenerator : (ip) => ip;

export const requesterKey = (req) => {
  const token = req.headers?.authorization || req.cookies?.auth_token;
  if (token) return `user:${token}`;

  const email = req.body?.email;
  if (typeof email === 'string' && email.length <= 254) {
    return `email:${email.trim().toLowerCase()}`;
  }

  return `ip:${normaliseIp(req.ip)}`;
};

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down and try again shortly.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please slow down and try again shortly.'
    });
  }
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification code requests. Please try again in 15 minutes.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many verification code requests. Please try again in 15 minutes.'
    });
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again in 15 minutes.'
    });
  }
});

export const containerOpsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many container operations. Please try again in 1 minute.'
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many container operations. Please try again in 1 minute.'
    });
  }
});

export const clubsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many club API requests. Please try again in 10 minutes.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many club API requests. Please try again in 10 minutes.'
    });
  }
});

export const spaceShareLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many share requests. Please try again in 1 minute.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many share requests. Please try again in 1 minute.'
    });
  }
});
