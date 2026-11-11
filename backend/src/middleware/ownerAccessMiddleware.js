import { getCurrentOwnerAccess } from '../services/ownerAccessService.js';

/**
 * Middleware: Resolves and attaches any active Owner Access context for the request.
 *
 * Attaches:
 * - req.ownerAccessContext: Object | null
 * - req.resourceUserId: string (points to target user ID when in owner-access mode, or req.userId)
 */
export async function resolveOwnerAccess(req, res, next) {
  try {
    const activeContextId = req.session?.activeOwnerAccessId;

    if (!activeContextId || !req.userId) {
      req.ownerAccessContext = null;
      req.resourceUserId = req.userId;
      return next();
    }

    // Only accounts with OWNER role are permitted to utilize owner access
    if (req.userRole !== 'OWNER' && req.user?.role !== 'OWNER') {
      delete req.session.activeOwnerAccessId;
      req.ownerAccessContext = null;
      req.resourceUserId = req.userId;
      return next();
    }

    const { active, accessContext, invalidated } = await getCurrentOwnerAccess({
      ownerId: req.userId,
      ownerSessionId: req.sessionID,
      activeContextId,
    });

    if (active && accessContext) {
      req.ownerAccessContext = accessContext;
      req.resourceUserId = accessContext.targetUser.id;
    } else {
      delete req.session.activeOwnerAccessId;
      req.ownerAccessContext = null;
      req.resourceUserId = req.userId;
    }

    return next();
  } catch (err) {
    console.error('[OwnerAccessMiddleware] Error resolving owner access context:', err);
    req.ownerAccessContext = null;
    req.resourceUserId = req.userId;
    return next();
  }
}

/**
 * Middleware: Strictly blocks all state-mutating requests when in Owner Access context.
 *
 * Allowed methods in Owner Access context: GET, HEAD, OPTIONS
 * Exempt mutation routes:
 * - POST /api/account/owner-access/exit
 * - POST /api/auth/logout
 */
export function enforceOwnerAccessReadOnly(req, res, next) {
  if (!req.ownerAccessContext) {
    return next();
  }

  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // Exempt routes that allow exiting or logging out
  const path = req.originalUrl || req.url;
  if (
    path.startsWith('/api/account/owner-access/exit') ||
    path.startsWith('/api/auth/logout')
  ) {
    return next();
  }

  return res.status(403).json({
    error: {
      message: 'Write operations are strictly forbidden while accessing another user account.',
      code: 'OWNER_READ_ONLY_ACCESS',
      targetUserId: req.ownerAccessContext.targetUser?.id,
    },
  });
}

