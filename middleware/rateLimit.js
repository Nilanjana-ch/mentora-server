import rateLimit from 'express-rate-limit';

const make = (opts, code, message) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ error: { code, message } }),
    ...opts,
  });

// 1) Per IP: shob /api request, 15 min-e 300 ta
export const ipLimiter = make(
  { windowMs: 15 * 60 * 1000, limit: 300 },
  'RATE_LIMITED_IP',
  'Too many requests. Please try again later.'
);

// 2) Per IP: shudhu failed (401) request gune, 15 min-e 20 ta
export const authFailLimiter = make(
  {
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
  },
  'RATE_LIMITED_AUTH',
  'Too many failed attempts. Please try again later.'
);

// 3) Per account (req.user.id), verifySession-er PORE boshbe
const byUser = (req) => req.user?.id || req.ip;

export const postCreateLimiter = make(
  { windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: byUser },
  'RATE_LIMITED_POST',
  'You can create at most 10 posts per hour.'
);

export const requestCreateLimiter = make(
  { windowMs: 60 * 60 * 1000, limit: 20, keyGenerator: byUser },
  'RATE_LIMITED_REQUEST',
  'You can send at most 20 requests per hour.'
);

export const writeLimiter = make(
  { windowMs: 60 * 1000, limit: 30, keyGenerator: byUser },
  'RATE_LIMITED_WRITE',
  'Too many changes. Please slow down.'
);