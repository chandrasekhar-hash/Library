import rateLimit from 'express-rate-limit';

/**
 * Custom error handler for rate limit violations.
 */
function rateLimitHandler(req, res) {
  res.status(429).json({
    error: {
      message: 'Too many requests from this IP. Please try again after 15 minutes.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  });
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
  handler: rateLimitHandler,
  skip: (req) => process.env.NODE_ENV === 'test', // Skip in automated testing if configured
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
  handler: rateLimitHandler,
  skip: (req) => process.env.NODE_ENV === 'test', // Skip in automated testing if configured
});
