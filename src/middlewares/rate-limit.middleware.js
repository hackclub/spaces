import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { postgresStore } from '../utils/rate-limit-store.js';

export const SEND_CODE_WINDOW_MS = 60 * 60 * 1000;
export const SEND_CODE_PER_IP = 20;
export const SEND_CODE_GLOBAL = 300;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_FAILURES_PER_IP = 30;
export const AUTH_ATTEMPTS_PER_EMAIL = 5;
export const OAUTH_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const OAUTH_LOGIN_PER_IP = 30;

export const ipKey = (req) => `ip:${ipKeyGenerator(req.ip)}`;

export const requesterKey = (req) => {
  const token = req.headers?.authorization || req.cookies?.auth_token;
  if (token) return `user:${token}`;

  return ipKey(req);
};

export const anonymousKey = (req) => {
  const email = req.body?.email;
  if (typeof email === 'string' && email.length <= 254) {
    return `email:${email.trim().toLowerCase()}`;
  }

  return ipKey(req);
};

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: ipKey,
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

export const sendCodeIpLimiter = rateLimit({
  windowMs: SEND_CODE_WINDOW_MS,
  max: SEND_CODE_PER_IP,
  keyGenerator: ipKey,
  store: postgresStore('send-code-ip:'),
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification codes were requested from your network. Please try again in an hour, or continue with Hack Club.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many verification codes were requested from your network. Please try again in an hour, or continue with Hack Club.'
    });
  }
});

export const sendCodeGlobalLimiter = rateLimit({
  windowMs: SEND_CODE_WINDOW_MS,
  max: SEND_CODE_GLOBAL,
  keyGenerator: () => 'global',
  store: postgresStore('send-code-global:'),
  skipFailedRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  message: {
    success: false,
    message: "We're sending a lot of verification codes right now. Please try again in a little while, or continue with Hack Club."
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "We're sending a lot of verification codes right now. Please try again in a little while, or continue with Hack Club."
    });
  }
});

export const authLimiter = rateLimit({
  windowMs: ACCOUNT_WINDOW_MS,
  max: AUTH_ATTEMPTS_PER_EMAIL,
  keyGenerator: anonymousKey,
  store: postgresStore('auth-email:'),
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

export const accountIpLimiter = rateLimit({
  windowMs: ACCOUNT_WINDOW_MS,
  max: ACCOUNT_FAILURES_PER_IP,
  keyGenerator: ipKey,
  store: postgresStore('account-ip:'),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed attempts from your network. Please try again in 15 minutes.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many failed attempts from your network. Please try again in 15 minutes.'
    });
  }
});

export const oauthLoginLimiter = rateLimit({
  windowMs: OAUTH_LOGIN_WINDOW_MS,
  max: OAUTH_LOGIN_PER_IP,
  keyGenerator: ipKey,
  store: postgresStore('oauth-login-ip:'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.redirect('/?error=oauth_rate_limited');
  }
});

export const containerOpsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: requesterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many space actions. Please try again in 1 minute.'
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many space actions. Please try again in 1 minute.'
    });
  }
});

export const clubsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
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
