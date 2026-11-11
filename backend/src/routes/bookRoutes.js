import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  createBook,
  listBooks,
  getBook,
  updateBook,
  deleteBook,
} from '../controllers/bookController.js';
import { uploadBookFile, streamBookFile } from '../controllers/bookFileController.js';
import {
  uploadBookCover,
  streamBookCover,
  resetBookCover,
  updateCoverPlacement,
} from '../controllers/bookCoverController.js';
import {
  createBookmark,
  listBookmarks,
} from '../controllers/bookmarkController.js';
import {
  createHighlight,
  listHighlights,
} from '../controllers/highlightController.js';
import {
  updateReadingProgress,
  getReadingProgress,
} from '../controllers/progressController.js';
import {
  getBookPreferences,
  updateBookPreferences,
} from '../controllers/preferenceController.js';
import {
  startReadingSession,
  finishReadingSession,
  getActiveSession,
  createReadingSession,
} from '../controllers/sessionController.js';
import {
  requestBookOcr,
  getBookOcrStatus,
  listBookPagesOcr,
  getBookPageOcr,
  cancelOcrJob,
  retryFailedPages,
  getOcrJob,
} from '../controllers/ocrController.js';
import { searchBook } from '../controllers/searchController.js';
import {
  uploadRateLimiter,
  searchRateLimiter,
  ocrDispatchRateLimiter,
} from '../middleware/rateLimiter.js';

const router = Router();

// All book endpoints require an authenticated user
router.use(requireAuth);

// ── Books CRUD ──────────────────────────────────────────────────────────────
router.post('/', validateCsrf, createBook);
router.get('/', listBooks);
router.get('/:bookId', getBook);
router.patch('/:bookId', validateCsrf, updateBook);
router.delete('/:bookId', validateCsrf, deleteBook);

// ── Book Private File Storage & Streaming ───────────────────────────────────
router.post('/:bookId/file', uploadRateLimiter, validateCsrf, uploadBookFile);
router.get('/:bookId/file', streamBookFile);

// ── Book Cover Private Storage & Streaming ──────────────────────────────────
router.post('/:bookId/cover', uploadRateLimiter, validateCsrf, uploadBookCover);
router.get('/:bookId/cover', streamBookCover);
router.patch('/:bookId/cover/placement', validateCsrf, updateCoverPlacement);
router.post('/:bookId/cover/reset', validateCsrf, resetBookCover);

// ── Nested Bookmarks ────────────────────────────────────────────────────────
router.post('/:bookId/bookmarks', validateCsrf, createBookmark);
router.get('/:bookId/bookmarks', listBookmarks);

// ── Nested Highlights ───────────────────────────────────────────────────────
router.post('/:bookId/highlights', validateCsrf, createHighlight);
router.get('/:bookId/highlights', listHighlights);

// ── Single Source of Truth Reading Progress ─────────────────────────────────
router.put('/:bookId/progress', validateCsrf, updateReadingProgress);
router.get('/:bookId/progress', getReadingProgress);

// ── Per-Book Preferences ────────────────────────────────────────────────────
router.get('/:bookId/preferences', getBookPreferences);
router.patch('/:bookId/preferences', validateCsrf, updateBookPreferences);

// ── Per-Book Reading Sessions Lifecycle ─────────────────────────────────────
router.post('/:bookId/sessions/start', validateCsrf, startReadingSession);
router.post('/:bookId/sessions/:sessionId/finish', validateCsrf, finishReadingSession);
router.get('/:bookId/sessions/active', getActiveSession);
router.post('/:bookId/sessions', validateCsrf, createReadingSession);

// ── Per-Book OCR & Search Index Lifecycle ───────────────────────────────────
router.post('/:bookId/ocr', ocrDispatchRateLimiter, validateCsrf, requestBookOcr);
router.get('/:bookId/ocr/status', getBookOcrStatus);
router.get('/:bookId/ocr/pages', listBookPagesOcr);
router.get('/:bookId/ocr/pages/:pageNumber', getBookPageOcr);
router.post('/:bookId/ocr/cancel', ocrDispatchRateLimiter, validateCsrf, cancelOcrJob);
router.post('/:bookId/ocr/retry', ocrDispatchRateLimiter, validateCsrf, retryFailedPages);
router.get('/:bookId/ocr/jobs/:jobId', getOcrJob);

// ── Per-Book Multilingual Search ────────────────────────────────────────────
router.get('/:bookId/search', searchRateLimiter, searchBook);

export default router;


