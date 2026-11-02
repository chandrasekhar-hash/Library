import { prisma } from '../services/prisma.js';

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

    // Attach verified user identity
    req.userId = user.id;
    req.user = user;

    return next();
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
      }
    }
    return next();
  } catch {
    return next();
  }
}
