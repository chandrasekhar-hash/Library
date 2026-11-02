import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { updateBookmark, deleteBookmark } from '../controllers/bookmarkController.js';

const router = Router();

// All bookmark endpoints require authentication
router.use(requireAuth);

router.patch('/:bookmarkId', validateCsrf, updateBookmark);
router.delete('/:bookmarkId', validateCsrf, deleteBookmark);

export default router;
