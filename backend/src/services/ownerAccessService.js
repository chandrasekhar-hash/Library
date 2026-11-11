import { prisma } from './prisma.js';

export class OwnerAccessError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'OwnerAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Initiates an isolated, session-bound Owner Access context to view a linked User's account.
 *
 * @param {Object} params
 * @param {string} params.ownerId - The authenticated Owner's user ID.
 * @param {string} params.ownerSessionId - The Owner's current express-session ID.
 * @param {string} params.targetUserId - The target User's user ID.
 * @returns {Promise<Object>} Sanitized context metadata
 */
export async function startOwnerAccess({ ownerId, ownerSessionId, targetUserId }) {
  if (!ownerId || !ownerSessionId) {
    throw new OwnerAccessError('Authentication and session required.', 'UNAUTHENTICATED', 401);
  }

  if (!targetUserId || typeof targetUserId !== 'string') {
    throw new OwnerAccessError('Target user ID is required.', 'TARGET_USER_REQUIRED', 400);
  }

  const cleanTargetUserId = targetUserId.trim();

  // Self-access check
  if (cleanTargetUserId === ownerId) {
    throw new OwnerAccessError('Owner cannot initiate owner access to their own account.', 'CANNOT_ACCESS_SELF', 400);
  }

  // 1. Verify the initiator is an active OWNER
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, role: true },
  });

  if (!owner || owner.role !== 'OWNER') {
    throw new OwnerAccessError('Only accounts with the OWNER role can initiate owner access.', 'OWNER_ROLE_REQUIRED', 403);
  }

  // 2. Verify target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: cleanTargetUserId },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!targetUser) {
    throw new OwnerAccessError('Target user account not found.', 'USER_NOT_FOUND', 404);
  }

  // 3. Verify an ACTIVE AccountRelationship exists between owner and target user
  const relationship = await prisma.accountRelationship.findFirst({
    where: {
      ownerId,
      userId: cleanTargetUserId,
      status: 'ACTIVE',
    },
  });

  if (!relationship) {
    throw new OwnerAccessError(
      'An active account relationship is required before owner access can be initiated.',
      'ACTIVE_RELATIONSHIP_REQUIRED',
      403
    );
  }

  // 4. Invalidate any previously active context for this owner session cleanly
  await prisma.ownerAccessContext.updateMany({
    where: {
      ownerId,
      ownerSessionId,
      status: 'ACTIVE',
    },
    data: {
      status: 'EXITED',
      endedAt: new Date(),
      revocationReason: 'SWITCHED_CONTEXT',
    },
  });

  // 5. Create new session-long OwnerAccessContext
  const context = await prisma.ownerAccessContext.create({
    data: {
      ownerId,
      targetUserId: cleanTargetUserId,
      relationshipId: relationship.id,
      ownerSessionId,
      status: 'ACTIVE',
      startedAt: new Date(),
    },
    include: {
      targetUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return {
    id: context.id,
    targetUser: context.targetUser,
    startedAt: context.startedAt,
    status: context.status,
  };
}

/**
 * Validates and retrieves the currently active Owner Access context for a session.
 *
 * @param {Object} params
 * @param {string} params.ownerId
 * @param {string} params.ownerSessionId
 * @param {string} params.activeContextId
 * @returns {Promise<{ active: boolean, accessContext: Object|null, invalidated?: boolean, reason?: string }>}
 */
export async function getCurrentOwnerAccess({ ownerId, ownerSessionId, activeContextId }) {
  if (!activeContextId || !ownerId || !ownerSessionId) {
    return { active: false, accessContext: null };
  }

  const context = await prisma.ownerAccessContext.findUnique({
    where: { id: activeContextId },
    include: {
      relationship: true,
      targetUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!context || context.status !== 'ACTIVE') {
    return { active: false, accessContext: null };
  }

  // Validate owner binding
  if (context.ownerId !== ownerId) {
    await prisma.ownerAccessContext.update({
      where: { id: context.id },
      data: {
        status: 'REVOKED',
        endedAt: new Date(),
        revocationReason: 'OWNER_MISMATCH',
      },
    });
    return { active: false, accessContext: null, invalidated: true, reason: 'OWNER_MISMATCH' };
  }

  // Validate session binding (must belong to this specific express session)
  if (context.ownerSessionId !== ownerSessionId) {
    await prisma.ownerAccessContext.update({
      where: { id: context.id },
      data: {
        status: 'EXPIRED',
        endedAt: new Date(),
        revocationReason: 'SESSION_MISMATCH',
      },
    });
    return { active: false, accessContext: null, invalidated: true, reason: 'SESSION_MISMATCH' };
  }

  // Validate relationship is still ACTIVE
  if (!context.relationship || context.relationship.status !== 'ACTIVE') {
    await prisma.ownerAccessContext.update({
      where: { id: context.id },
      data: {
        status: 'REVOKED',
        endedAt: new Date(),
        revocationReason: 'RELATIONSHIP_REVOKED',
      },
    });
    return { active: false, accessContext: null, invalidated: true, reason: 'RELATIONSHIP_REVOKED' };
  }

  return {
    active: true,
    accessContext: {
      id: context.id,
      targetUser: context.targetUser,
      startedAt: context.startedAt,
      status: context.status,
    },
  };
}

/**
 * Exits an active Owner Access context and returns the Owner to their normal account view.
 *
 * @param {Object} params
 * @param {string} params.ownerId
 * @param {string} params.ownerSessionId
 * @param {string} [params.activeContextId]
 * @returns {Promise<void>}
 */
export async function exitOwnerAccess({ ownerId, ownerSessionId, activeContextId }) {
  if (activeContextId) {
    await prisma.ownerAccessContext.updateMany({
      where: {
        id: activeContextId,
        ownerId,
        status: 'ACTIVE',
      },
      data: {
        status: 'EXITED',
        endedAt: new Date(),
        revocationReason: 'USER_EXIT',
      },
    });
  }

  // Also clean up any lingering active contexts for this owner session
  if (ownerId && ownerSessionId) {
    await prisma.ownerAccessContext.updateMany({
      where: {
        ownerId,
        ownerSessionId,
        status: 'ACTIVE',
      },
      data: {
        status: 'EXITED',
        endedAt: new Date(),
        revocationReason: 'USER_EXIT',
      },
    });
  }
}

/**
 * Invalidate all active contexts associated with an express session (e.g. on logout or destruction).
 *
 * @param {string} ownerSessionId
 * @param {string} [reason='SESSION_INVALIDATED']
 */
export async function invalidateSessionAccess(ownerSessionId, reason = 'SESSION_INVALIDATED') {
  if (!ownerSessionId) return;
  await prisma.ownerAccessContext.updateMany({
    where: {
      ownerSessionId,
      status: 'ACTIVE',
    },
    data: {
      status: 'REVOKED',
      endedAt: new Date(),
      revocationReason: reason,
    },
  });
}

/**
 * Invalidate all active contexts associated with a revoked AccountRelationship.
 *
 * @param {string} relationshipId
 * @param {string} [reason='RELATIONSHIP_REVOKED']
 */
export async function invalidateRelationshipAccess(relationshipId, reason = 'RELATIONSHIP_REVOKED') {
  if (!relationshipId) return;
  await prisma.ownerAccessContext.updateMany({
    where: {
      relationshipId,
      status: 'ACTIVE',
    },
    data: {
      status: 'REVOKED',
      endedAt: new Date(),
      revocationReason: reason,
    },
  });
}

/**
 * Returns safe audit history of Owner Access events for an Owner.
 *
 * @param {Object} params
 * @param {string} params.ownerId
 * @param {number} [params.skip=0]
 * @param {number} [params.limit=50]
 */
export async function listAccessHistory({ ownerId, skip = 0, limit = 50 }) {
  const [history, total] = await Promise.all([
    prisma.ownerAccessContext.findMany({
      where: { ownerId },
      orderBy: { startedAt: 'desc' },
      skip: Math.max(0, parseInt(skip, 10) || 0),
      take: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
      include: {
        targetUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.ownerAccessContext.count({
      where: { ownerId },
    }),
  ]);

  return {
    history: history.map((item) => ({
      id: item.id,
      targetUser: item.targetUser,
      status: item.status,
      revocationReason: item.revocationReason,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
    })),
    total,
  };
}

