import {
  startOwnerAccess as serviceStartOwnerAccess,
  getCurrentOwnerAccess as serviceGetCurrentOwnerAccess,
  exitOwnerAccess as serviceExitOwnerAccess,
  listAccessHistory as serviceListAccessHistory,
  OwnerAccessError,
} from '../services/ownerAccessService.js';
import { parsePagination } from '../utils/validators.js';

/**
 * Controller: Owner-Authorized Account Access (Phase ACCOUNT-1B)
 */

/**
 * POST /api/account/owner-access/start
 * Start a read-only Owner Access context for a linked user.
 */
export async function startOwnerAccess(req, res, next) {
  try {
    const { targetUserId } = req.body || {};
    const ownerId = req.userId;
    const ownerSessionId = req.sessionID;

    if (!targetUserId || typeof targetUserId !== 'string') {
      return res.status(400).json({
        error: {
          message: 'Target user ID is required in request body.',
          code: 'TARGET_USER_REQUIRED',
        },
      });
    }

    const accessContext = await serviceStartOwnerAccess({
      ownerId,
      ownerSessionId,
      targetUserId,
    });

    // Save active context ID to the Owner's express session
    req.session.activeOwnerAccessId = accessContext.id;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[OwnerAccessController] Error persisting session post-start:', saveErr);
        return next(saveErr);
      }

      return res.status(200).json({
        message: 'Owner access started successfully.',
        accessContext,
      });
    });
  } catch (err) {
    if (err instanceof OwnerAccessError || err.statusCode) {
      return res.status(err.statusCode || 400).json({
        error: {
          message: err.message,
          code: err.code || 'OWNER_ACCESS_FAILED',
        },
      });
    }
    next(err);
  }
}

/**
 * GET /api/account/owner-access/current
 * Retrieve status of the currently active owner access context for this session.
 */
export async function getCurrentOwnerAccess(req, res, next) {
  try {
    const ownerId = req.userId;
    const ownerSessionId = req.sessionID;
    const activeContextId = req.session?.activeOwnerAccessId;

    const result = await serviceGetCurrentOwnerAccess({
      ownerId,
      ownerSessionId,
      activeContextId,
    });

    if (!result.active && req.session?.activeOwnerAccessId) {
      delete req.session.activeOwnerAccessId;
      req.session.save(() => {});
    }

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/account/owner-access/exit
 * Exit the active owner access context and return to normal Owner account view.
 */
export async function exitOwnerAccess(req, res, next) {
  try {
    const ownerId = req.userId;
    const ownerSessionId = req.sessionID;
    const activeContextId = req.session?.activeOwnerAccessId;

    await serviceExitOwnerAccess({
      ownerId,
      ownerSessionId,
      activeContextId,
    });

    delete req.session.activeOwnerAccessId;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[OwnerAccessController] Error persisting session post-exit:', saveErr);
        return next(saveErr);
      }

      return res.status(200).json({
        message: 'Owner access exited successfully.',
      });
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/account/owner-access/history
 * List historical owner access audit logs for the authenticated Owner.
 */
export async function listAccessHistory(req, res, next) {
  try {
    const ownerId = req.userId;
    const { page, limit, skip } = parsePagination(req.query);

    const { history, total } = await serviceListAccessHistory({
      ownerId,
      skip,
      limit,
    });

    return res.status(200).json({
      history,
      total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

