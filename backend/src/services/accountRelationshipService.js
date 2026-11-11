import { prisma } from './prisma.js';
import { normalizeEmail } from '../utils/validators.js';
import { invalidateRelationshipAccess } from './ownerAccessService.js';

/**
 * Service managing Owner/User Roles & Account Relationships for Aks (अक्स)
 * Phase: ACCOUNT-1A
 *
 * Enforces:
 * - Controlled bootstrap of the primary Owner account.
 * - Multi-tenant isolation: Owners can only view and manage their own linked users.
 * - Prevention of self-linking, owner-to-owner linking, and duplicate linking.
 * - Immediate revocation and state consistency.
 */
export class AccountRelationshipService {
  /**
   * Controlled one-time bootstrap procedure to establish an account as OWNER.
   *
   * @param {string} email - Exact email of the account to promote to OWNER
   * @returns {Promise<{ user: Object, message: string, newlyPromoted: boolean }>}
   */
  static async bootstrapOwnerAccount(email) {
    if (!email || typeof email !== 'string') {
      const err = new Error('A valid email address is required to bootstrap an Owner account.');
      err.statusCode = 400;
      err.code = 'INVALID_BOOTSTRAP_INPUT';
      throw err;
    }

    const normalized = normalizeEmail(email);

    // 1. Verify user exists
    const user = await prisma.user.findUnique({
      where: { email: normalized },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      const err = new Error(`User account with email "${normalized}" was not found.`);
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    // 2. Check if an OWNER already exists in the system
    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
      select: { id: true, email: true, name: true },
    });

    if (existingOwner) {
      if (existingOwner.id === user.id) {
        return {
          user,
          message: `User "${normalized}" is already established as the Owner.`,
          newlyPromoted: false,
        };
      }

      const err = new Error(
        `An Owner account already exists ("${existingOwner.email}"). Only one primary Owner is permitted.`
      );
      err.statusCode = 409;
      err.code = 'OWNER_ALREADY_EXISTS';
      throw err;
    }

    // 3. Atomically promote the user to OWNER
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'OWNER' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return {
      user: updated,
      message: `User "${normalized}" successfully established as the Owner.`,
      newlyPromoted: true,
    };
  }

  /**
   * Retrieve all users linked to the specified Owner account.
   *
   * @param {string} ownerId
   * @returns {Promise<Array<Object>>}
   */
  static async listLinkedUsers(ownerId) {
    if (!ownerId) {
      throw new Error('ownerId is required to list linked users.');
    }

    const relationships = await prisma.accountRelationship.findMany({
      where: { ownerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return relationships.map((rel) => ({
      id: rel.id,
      userId: rel.userId,
      status: rel.status,
      createdAt: rel.createdAt,
      updatedAt: rel.updatedAt,
      user: rel.user,
    }));
  }

  /**
   * Establish a relationship linking an eligible User to an Owner account.
   *
   * @param {Object} params
   * @param {string} params.ownerId - Authenticated Owner ID
   * @param {string} [params.targetUserId] - User ID to link
   * @param {string} [params.targetEmail] - Email of the user to link
   * @returns {Promise<{ relationship: Object, isReactivated: boolean }>}
   */
  static async linkUser({ ownerId, targetUserId, targetEmail }) {
    if (!ownerId) {
      const err = new Error('ownerId is required.');
      err.statusCode = 400;
      err.code = 'MISSING_OWNER_ID';
      throw err;
    }

    if (!targetUserId && !targetEmail) {
      const err = new Error('Either targetUserId or targetEmail must be provided.');
      err.statusCode = 400;
      err.code = 'MISSING_TARGET_USER';
      throw err;
    }

    // 1. Verify owner identity and role
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, role: true },
    });

    if (!owner || owner.role !== 'OWNER') {
      const err = new Error('Access denied. Only Owner accounts can establish user relationships.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_OWNER_REQUIRED';
      throw err;
    }

    // 2. Resolve target user
    const normalizedEmail = targetEmail ? normalizeEmail(targetEmail) : undefined;
    const targetUser = await prisma.user.findFirst({
      where: targetUserId ? { id: targetUserId } : { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!targetUser) {
      const err = new Error('Target user account not found.');
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    // 3. Reject self-linking
    if (targetUser.id === ownerId) {
      const err = new Error('An Owner account cannot be linked to itself.');
      err.statusCode = 400;
      err.code = 'CANNOT_LINK_SELF';
      throw err;
    }

    // 4. Reject linking another OWNER account
    if (targetUser.role === 'OWNER') {
      const err = new Error('An Owner account cannot be linked as a managed user.');
      err.statusCode = 400;
      err.code = 'CANNOT_LINK_OWNER';
      throw err;
    }

    // 5. Inspect existing relationship for this user
    const existing = await prisma.accountRelationship.findUnique({
      where: { userId: targetUser.id },
    });

    if (existing) {
      if (existing.ownerId === ownerId) {
        if (existing.status === 'ACTIVE') {
          const err = new Error('User is already actively linked to this Owner account.');
          err.statusCode = 409;
          err.code = 'RELATIONSHIP_ALREADY_EXISTS';
          throw err;
        }

        // Reactivate revoked relationship for the same owner
        const reactivated = await prisma.accountRelationship.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
              },
            },
          },
        });

        return {
          relationship: {
            id: reactivated.id,
            userId: reactivated.userId,
            status: reactivated.status,
            createdAt: reactivated.createdAt,
            updatedAt: reactivated.updatedAt,
            user: reactivated.user,
          },
          isReactivated: true,
        };
      }

      // Existing relationship belongs to a different owner
      if (existing.status === 'ACTIVE') {
        const err = new Error('User is already linked to another Owner account.');
        err.statusCode = 409;
        err.code = 'USER_ALREADY_LINKED';
        throw err;
      }

      // Previously revoked relationship with another owner: reassign to this owner
      const reassigned = await prisma.accountRelationship.update({
        where: { id: existing.id },
        data: {
          ownerId,
          status: 'ACTIVE',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              createdAt: true,
            },
          },
        },
      });

      return {
        relationship: {
          id: reassigned.id,
          userId: reassigned.userId,
          status: reassigned.status,
          createdAt: reassigned.createdAt,
          updatedAt: reassigned.updatedAt,
          user: reassigned.user,
        },
        isReactivated: true,
      };
    }

    // 6. Create brand new relationship
    const created = await prisma.accountRelationship.create({
      data: {
        ownerId,
        userId: targetUser.id,
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      relationship: {
        id: created.id,
        userId: created.userId,
        status: created.status,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        user: created.user,
      },
      isReactivated: false,
    };
  }

  /**
   * Revoke an active relationship with a linked user.
   *
   * @param {Object} params
   * @param {string} params.ownerId - Authenticated Owner ID
   * @param {string} [params.targetUserId] - Linked User ID
   * @param {string} [params.relationshipId] - Relationship ID
   * @returns {Promise<Object>} The revoked relationship record
   */
  static async revokeRelationship({ ownerId, targetUserId, relationshipId }) {
    if (!ownerId) {
      const err = new Error('ownerId is required.');
      err.statusCode = 400;
      err.code = 'MISSING_OWNER_ID';
      throw err;
    }

    if (!targetUserId && !relationshipId) {
      const err = new Error('Either targetUserId or relationshipId must be provided.');
      err.statusCode = 400;
      err.code = 'MISSING_IDENTIFIER';
      throw err;
    }

    const relationship = await prisma.accountRelationship.findFirst({
      where: relationshipId
        ? { id: relationshipId }
        : { userId: targetUserId },
    });

    if (!relationship) {
      const err = new Error('Relationship not found.');
      err.statusCode = 404;
      err.code = 'RELATIONSHIP_NOT_FOUND';
      throw err;
    }

    // Multi-tenant check: ensure this relationship belongs to the requesting owner
    if (relationship.ownerId !== ownerId) {
      const err = new Error('Relationship not found or access denied.');
      err.statusCode = 404;
      err.code = 'RELATIONSHIP_NOT_FOUND';
      throw err;
    }

    const updated = await prisma.accountRelationship.update({
      where: { id: relationship.id },
      data: { status: 'REVOKED' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    // Invalidate any active owner access contexts using this relationship
    await invalidateRelationshipAccess(relationship.id, 'RELATIONSHIP_REVOKED');

    return {
      id: updated.id,
      userId: updated.userId,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      user: updated.user,
    };
  }

  /**
   * Verify whether an active relationship exists between an Owner and a target User.
   *
   * @param {string} ownerId
   * @param {string} targetUserId
   * @returns {Promise<boolean>}
   */
  static async verifyOwnerUserRelationship(ownerId, targetUserId) {
    if (!ownerId || !targetUserId) return false;

    const rel = await prisma.accountRelationship.findFirst({
      where: {
        ownerId,
        userId: targetUserId,
        status: 'ACTIVE',
      },
    });

    return Boolean(rel);
  }
}

