import { prisma } from '../services/prisma.js';
import { resolveOwnerAccess, enforceOwnerAccessReadOnly } from './ownerAccessMiddleware.js';
import { maskMobileNumber } from '../utils/validators.js';

/**
 * Reusable Authentication Middleware for Aks (अक्स)
 *
 * Verifies that:
 * 1. An active session exists on the request.
 * 2. The session contains an authenticated userId.
 * 3. The associated User record still exists in PostgreSQL.
 *
 * Attaches:
 * - req.userId: string (strictly from session, NEVER from body/query)
 * - req.user: { id, name, email, createdAt }
 */
export async function requireAuth(req, res, next) {
  try {
    const sessionUserId = req.session?.userId;

    if (!sessionUserId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required. Please log in to continue.',
          code: 'UNAUTHENTICATED',
        },
      });
    }

    // Verify user still exists in the database (e.g. not deleted while session was active)
    const user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobileNumber: true,
        createdAt: true,
      },
    });

    if (!user) {
      // Invalidate orphaned session
      req.session.destroy(() => {});
      return res.status(401).json({
        error: {
          message: 'User account no longer exists. Please sign up or log in with another account.',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    // Attach verified user identity and role (with safe masked mobile metadata)
    req.userId = user.id;
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      hasMobileNumber: Boolean(user.mobileNumber),
      mobileNumberMasked: maskMobileNumber(user.mobileNumber),
      createdAt: user.createdAt,
    };
    req.userRole = user.role;

    return resolveOwnerAccess(req, res, () => {
      enforceOwnerAccessReadOnly(req, res, next);
    });
  } catch (err) {
    console.error('[AuthMiddleware] Error during session authentication:', err);
    return res.status(500).json({
      error: {
        message: 'Internal authentication error.',
        code: 'AUTH_INTERNAL_ERROR',
      },
    });
  }
}

/**
 * Optional authentication middleware:
 * Attaches req.user and req.userId if a valid session exists, but does not block unauthenticated requests.
 */
export async function optionalAuth(req, res, next) {
  try {
    const sessionUserId = req.session?.userId;
    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });

      if (user) {
        req.userId = user.id;
        req.user = user;
        req.userRole = user.role;
        return resolveOwnerAccess(req, res, next);
      }
    }
    req.resourceUserId = null;
    req.ownerAccessContext = null;
    return next();
  } catch {
    return next();
  }
}

/**
 * Middleware factory enforcing specific role permissions.
 *
 * @param {...string} allowedRoles - E.g. 'OWNER', 'USER'
 * @returns {Function} Express middleware
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required. Please log in to continue.',
          code: 'UNAUTHENTICATED',
        },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          message: 'Access denied. Insufficient role permissions.',
          code: 'FORBIDDEN_ROLE_REQUIRED',
          requiredRoles: allowedRoles,
        },
      });
    }

    return next();
  };
}

/**
 * Convenience middleware requiring the authenticated user to possess the OWNER role.
 */
export const requireOwner = requireRole('OWNER');
