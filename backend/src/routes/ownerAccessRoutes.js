import { Router } from 'express';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  startOwnerAccess,
  getCurrentOwnerAccess,
  exitOwnerAccess,
  listAccessHistory,
} from '../controllers/ownerAccessController.js';

const router = Router();

// All owner access endpoints require an authenticated Owner
router.use(requireAuth);
router.use(requireOwner);

router.post('/start', validateCsrf, startOwnerAccess);
router.get('/current', getCurrentOwnerAccess);
router.post('/exit', validateCsrf, exitOwnerAccess);
router.get('/history', listAccessHistory);

export default router;

