/**
 * Library-Wide Indexing Controller for Aks (अक्स)
 *
 * Exposes endpoints for:
 * - Inspecting library-wide OCR and native text indexing coverage
 * - Triggering safe library-wide backfill
 * - Pausing and resuming the persistent sequential queue
 * - Retrying failed pages and books across the library
 */

import { IndexingQueueService } from '../services/indexingQueueService.js';

/**
 * GET /api/ocr/library/status (and /api/library/indexing/status)
 * Returns complete library indexing overview and per-book progress.
 */
export async function getLibraryIndexingStatus(req, res, next) {
  try {
    const userId = req.userId;
    const status = await IndexingQueueService.getLibraryIndexingStatus(userId);
    return res.status(200).json(status);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ocr/library/start (and /api/library/indexing/start)
 * Enqueues all eligible unindexed or partially indexed books.
 */
export async function startLibraryIndexing(req, res, next) {
  try {
    const userId = req.userId;
    const { language } = req.body || {};

    const result = await IndexingQueueService.enqueueLibraryBackfill(userId, { language });
    return res.status(202).json({
      message: result.enqueuedCount > 0
        ? `Queued ${result.enqueuedCount} book(s) for library-wide indexing.`
        : 'All eligible books are already fully indexed or currently in queue.',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ocr/library/pause (and /api/library/indexing/pause)
 * Pauses the sequential queue runner for the authenticated user.
 */
export async function pauseLibraryIndexing(req, res, next) {
  try {
    const userId = req.userId;
    const result = await IndexingQueueService.pauseUserQueue(userId);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ocr/library/resume (and /api/library/indexing/resume)
 * Resumes the sequential queue runner for the authenticated user.
 */
export async function resumeLibraryIndexing(req, res, next) {
  try {
    const userId = req.userId;
    const result = await IndexingQueueService.resumeUserQueue(userId);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ocr/library/retry-failed (and /api/library/indexing/retry-failed)
 * Re-enqueues failed or incomplete books for the authenticated user.
 */
export async function retryFailedLibraryIndexing(req, res, next) {
  try {
    const userId = req.userId;
    const result = await IndexingQueueService.retryFailedLibraryJobs(userId);
    return res.status(202).json({
      message: result.retriedCount > 0
        ? `Queued ${result.retriedCount} book(s) with failed or unindexed pages for retry.`
        : 'No eligible failed books found to retry.',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

