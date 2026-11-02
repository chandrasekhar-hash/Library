import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  getStudyStatistics,
  listReadingSessions,
  resetStudyTime,
  startReadingSession,
  finishReadingSession,
  getActiveSession,
  createReadingSession,
} from '../controllers/sessionController.js';

const router = Router();

// All statistics routes require authentication
router.use(requireAuth);

router.get('/', getStudyStatistics);
router.get('/sessions', listReadingSessions);
router.get('/sessions/active', getActiveSession);
router.post('/sessions/start', validateCsrf, startReadingSession);
router.post('/sessions/:sessionId/finish', validateCsrf, finishReadingSession);
router.post('/sessions', validateCsrf, createReadingSession);
router.post('/reset', validateCsrf, resetStudyTime);

export default router;

