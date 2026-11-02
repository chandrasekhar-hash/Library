/**
 * Library Indexing Routes for Aks (अक्स)
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
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
router.post('/start', validateCsrf, startLibraryIndexing);
router.post('/pause', validateCsrf, pauseLibraryIndexing);
router.post('/resume', validateCsrf, resumeLibraryIndexing);
router.post('/retry-failed', validateCsrf, retryFailedLibraryIndexing);

export default router;

