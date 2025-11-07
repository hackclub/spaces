import rateLimit from 'express-rate-limit';

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
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
