import { Router } from 'express';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  listLinkedUsers,
  linkUser,
  revokeRelationship,
} from '../controllers/accountRelationshipController.js';

const router = Router();

// All relationship management endpoints strictly require authentication and OWNER role
router.use(requireAuth);
router.use(requireOwner);

// GET /api/account/relationships — List all linked users
router.get('/', listLinkedUsers);

// POST /api/account/relationships — Link an eligible user
router.post('/', validateCsrf, linkUser);

// DELETE /api/account/relationships/:targetUserId — Revoke relationship
router.delete('/:targetUserId', validateCsrf, revokeRelationship);

export default router;

