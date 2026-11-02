import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  getOcrHealth,
  getOcrJob,
  cancelOcrJob,
} from '../controllers/ocrController.js';
import libraryIndexingRoutes from './libraryIndexingRoutes.js';

const router = Router();

// Health check endpoint (non-blocking loopback status, independent of sessions)
router.get('/health', getOcrHealth);

// Authenticated job management routes
router.use(requireAuth);

// Library-wide indexing routes (/api/ocr/library/status, /start, /pause, /resume, /retry-failed)
router.use('/library', libraryIndexingRoutes);

router.get('/jobs/:jobId', getOcrJob);
router.post('/jobs/:jobId/cancel', validateCsrf, cancelOcrJob);

export default router;

