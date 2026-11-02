import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  getGlobalPreferences,
  updateGlobalPreferences,
} from '../controllers/preferenceController.js';

const router = Router();

// All preferences routes require authentication
router.use(requireAuth);

router.get('/', getGlobalPreferences);
router.patch('/', validateCsrf, updateGlobalPreferences);

export default router;
