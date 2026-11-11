import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const isProduction = () => process.env.NODE_ENV === 'production';
const isTest = () => process.env.NODE_ENV === 'test';

/**
 * Authentication rate limits (register & login) defense rules:
 * - In production: NEVER bypassable under any condition (header or env flag).
 * - In test: Bypassable to permit automated test suites, unless explicitly testing rate limits.
 */
const canBypassAuthLimits = (req) => {
  if (isProduction()) return false;
  return isTest() && req.headers['x-test-rate-limit'] !== 'true';
};

/**
 * Operational rate limits (uploads, search, OCR dispatch):
 * - In production: NEVER bypassable by headers or accidental env settings.
 * - In non-production: Bypassable via explicit testing or developer flags.
 */
const canBypassOperationalLimits = (req) => {
  if (isProduction()) return false;
  return (
    process.env.RATE_LIMITS_DISABLED === 'true' ||
    req.headers['x-bypass-rate-limit'] === 'true'
  );
};

/**
 * Custom error handler for rate limit violations.
 */
function createRateLimitHandler(message, code = 'RATE_LIMIT_EXCEEDED') {
  return (req, res) => {
    res.status(429).json({
      error: {
        message,
        code,
      },
    });
  };
}

/**
 * Rate limiter for registration endpoint.
 * Allows up to 10 account creation attempts per 15-minute window per IP.
 */
export const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('Too many requests from this IP. Please try again after 15 minutes.'),
  skip: (req) => canBypassAuthLimits(req),
});

/**
 * Rate limiter for login endpoint.
 * Allows up to 15 authentication attempts per 15-minute window per IP to defend against brute force.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('Too many requests from this IP. Please try again after 15 minutes.'),
  skip: (req) => canBypassAuthLimits(req),
});

/**
 * Rate limiter for password recovery endpoints (verify & reset).
 * Allows up to 5 attempts per 15-minute window per IP to defend against brute force and enumeration.
 */
export const recoveryRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('Too many recovery attempts. Please try again after 15 minutes.'),
  skip: (req) => canBypassAuthLimits(req),
});

/**
 * Rate limiter for file upload endpoints (PDF, covers, user assets).
 * Scoped per authenticated userId (falling back to IP for unauthenticated).
 */
export const uploadRateLimiter = rateLimit({
  windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MS,
  max: env.UPLOAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => req.userId || req.ip || 'anonymous',
  handler: createRateLimitHandler('Upload rate limit exceeded. Please wait before uploading more files.'),
  skip: (req) => canBypassOperationalLimits(req),
});

/**
 * Rate limiter for expensive book search queries.
 * Scoped per authenticated userId (falling back to IP for unauthenticated).
 */
export const searchRateLimiter = rateLimit({
  windowMs: env.SEARCH_RATE_LIMIT_WINDOW_MS,
  max: env.SEARCH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => req.userId || req.ip || 'anonymous',
  handler: createRateLimitHandler('Search rate limit exceeded. Please wait a moment before searching again.'),
  skip: (req) => canBypassOperationalLimits(req),
});

/**
 * Rate limiter for OCR dispatch and queue management operations.
 * Scoped per authenticated userId (falling back to IP for unauthenticated).
 */
export const ocrDispatchRateLimiter = rateLimit({
  windowMs: env.OCR_DISPATCH_RATE_LIMIT_WINDOW_MS,
  max: env.OCR_DISPATCH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => req.userId || req.ip || 'anonymous',
  handler: createRateLimitHandler('OCR request rate limit exceeded. Please wait before submitting more OCR tasks.'),
  skip: (req) => canBypassOperationalLimits(req),
});
