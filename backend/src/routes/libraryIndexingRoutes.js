/**
 * Library Indexing Routes for Aks (अक्स)
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { ocrDispatchRateLimiter } from '../middleware/rateLimiter.js';
import {
  getLibraryIndexingStatus,
  startLibraryIndexing,
  pauseLibraryIndexing,
  resumeLibraryIndexing,
  retryFailedLibraryIndexing,
} from '../controllers/libraryIndexingController.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

router.get('/status', getLibraryIndexingStatus);
router.post('/start', ocrDispatchRateLimiter, validateCsrf, startLibraryIndexing);
router.post('/pause', validateCsrf, pauseLibraryIndexing);
router.post('/resume', validateCsrf, resumeLibraryIndexing);
router.post('/retry-failed', ocrDispatchRateLimiter, validateCsrf, retryFailedLibraryIndexing);

export default router;

