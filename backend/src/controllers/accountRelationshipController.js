import { AccountRelationshipService } from '../services/accountRelationshipService.js';

/**
 * Controller for Owner/User Account Relationships
 * Phase: ACCOUNT-1A
 */

/**
 * GET /api/account/relationships
 * List all users linked to the authenticated Owner account.
 */
export async function listLinkedUsers(req, res, next) {
  try {
    const ownerId = req.userId;
    const relationships = await AccountRelationshipService.listLinkedUsers(ownerId);

    return res.status(200).json({
      relationships,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/account/relationships
 * Link an eligible User account to the authenticated Owner account.
 * Body: { targetUserId?: string, targetEmail?: string }
 */
export async function linkUser(req, res, next) {
  try {
    const ownerId = req.userId;
    const { targetUserId, targetEmail } = req.body || {};

    if (!targetUserId && !targetEmail) {
      return res.status(400).json({
        error: {
          message: 'Please provide either targetUserId or targetEmail.',
          code: 'MISSING_TARGET_USER',
        },
      });
    }

    const result = await AccountRelationshipService.linkUser({
      ownerId,
      targetUserId,
      targetEmail,
    });

    return res.status(201).json({
      message: result.isReactivated
        ? 'User relationship reactivated successfully.'
        : 'User relationship established successfully.',
      relationship: result.relationship,
      isReactivated: result.isReactivated,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: {
          message: err.message,
          code: err.code || 'RELATIONSHIP_ERROR',
        },
      });
    }
    next(err);
  }
}

/**
 * DELETE /api/account/relationships/:targetUserId
 * Revoke an active relationship with a linked user.
 */
export async function revokeRelationship(req, res, next) {
  try {
    const ownerId = req.userId;
    const { targetUserId } = req.params;

    if (!targetUserId) {
      return res.status(400).json({
        error: {
          message: 'targetUserId is required in URL parameters.',
          code: 'MISSING_USER_ID',
        },
      });
    }

    const relationship = await AccountRelationshipService.revokeRelationship({
      ownerId,
      targetUserId,
    });

    return res.status(200).json({
      message: 'User relationship revoked successfully.',
      relationship,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: {
          message: err.message,
          code: err.code || 'RELATIONSHIP_ERROR',
        },
      });
    }
    next(err);
  }
}

