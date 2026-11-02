import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { updateHighlight, deleteHighlight } from '../controllers/highlightController.js';

const router = Router();

// All highlight endpoints require authentication
router.use(requireAuth);

router.patch('/:highlightId', validateCsrf, updateHighlight);
router.delete('/:highlightId', validateCsrf, deleteHighlight);

export default router;
