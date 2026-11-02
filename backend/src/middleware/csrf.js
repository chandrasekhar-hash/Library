import crypto from 'crypto';

/**
 * CSRF Protection Middleware for Aks (अक्स)
 *
 * Uses cryptographically secure random tokens stored in the user's server-side session.
 * For SPA compatibility (React on port 5173 + Express on port 5050):
 * - Token is retrieved via GET /api/auth/csrf
 * - Frontend includes token in header: 'X-CSRF-Token' (or 'x-csrf-token')
 * - State-changing requests (POST, PUT, PATCH, DELETE) are validated using constant-time comparison.
 */

/**
 * Generates or retrieves the session-associated CSRF token.
 *
 * @param {import('express').Request} req
 * @returns {string} CSRF token
 */
export function getOrCreateCsrfToken(req) {
  if (!req.session) {
    throw new Error('Session middleware must be mounted before CSRF middleware.');
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  return req.session.csrfToken;
}

/**
 * Middleware ensuring a CSRF token exists on every active session.
 */
export function csrfTokenGenerator(req, res, next) {
  if (req.session) {
    getOrCreateCsrfToken(req);
  }
  next();
}

/**
 * Validates CSRF token on state-changing HTTP requests.
 * Uses timing-safe string comparison.
 */
export function validateCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

  if (safeMethods.includes(method)) {
    return next();
  }

  const sessionToken = req.session?.csrfToken;
  const providedToken =
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    req.body?._csrf;

  if (!sessionToken || !providedToken || typeof providedToken !== 'string') {
    return res.status(403).json({
      error: {
        message: 'Invalid or missing CSRF token.',
        code: 'EBADCSRFTOKEN',
      },
    });
  }

  // Constant-time comparison to prevent timing attacks
  const sessionBuffer = Buffer.from(sessionToken, 'utf-8');
  const providedBuffer = Buffer.from(providedToken, 'utf-8');

  if (
    sessionBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(sessionBuffer, providedBuffer)
  ) {
    return res.status(403).json({
      error: {
        message: 'Invalid or missing CSRF token.',
        code: 'EBADCSRFTOKEN',
      },
    });
  }

  return next();
}
