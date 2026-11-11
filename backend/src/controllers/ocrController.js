/**
 * OCR Controller for Aks (अक्स)
 *
 * Exposes authenticated endpoints for:
 * - Requesting asynchronous OCR for owned books
 * - Inspecting OCR job lifecycle status and progress
 * - Retrieving page-level raw text and normalized search tokens
 * - Retrying failed pages and cancelling active jobs
 * - Health verification of the underlying OCR worker
 */

import { OcrJobService } from '../services/ocrJobService.js';
import { ocrClient } from '../services/ocrClient.js';

/**
 * POST /api/books/:bookId/ocr
 * Request asynchronous OCR processing for an owned book.
 */
export async function requestBookOcr(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;
    const { language, force, idempotencyKey: bodyKey } = req.body || {};
    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey = bodyKey || headerKey || null;

    const { job, isExisting } = await OcrJobService.requestJob({
      userId,
      bookId,
      language: language || 'en',
      force: Boolean(force),
      idempotencyKey,
    });

    return res.status(isExisting ? 200 : 202).json({
      message: isExisting
        ? 'Active or idempotent OCR job already exists for this volume.'
        : 'OCR job queued successfully for background processing.',
      job,
      isExisting,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/ocr/status
 * Get the latest OCR job status and page coverage overview for an owned book.
 */
export async function getBookOcrStatus(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.resourceUserId || req.userId;

    const status = await OcrJobService.getBookOcrStatus(bookId, userId);
    return res.status(200).json(status);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/ocr/jobs/:jobId
 * or GET /api/ocr/jobs/:jobId
 * Retrieve the status of a specific OCR job.
 */
export async function getOcrJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const userId = req.resourceUserId || req.userId;

    const job = await OcrJobService.getJobStatus(jobId, userId);
    return res.status(200).json({ job });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/ocr/pages
 * Retrieve all page-level OCR results for an owned book.
 */
export async function listBookPagesOcr(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.resourceUserId || req.userId;

    const pages = await OcrJobService.listBookPagesOcr(bookId, userId);
    return res.status(200).json({
      bookId,
      pageCount: pages.length,
      pages,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/ocr/pages/:pageNumber
 * Retrieve OCR text, confidence, and bounding boxes for a single page.
 */
export async function getBookPageOcr(req, res, next) {
  try {
    const { bookId, pageNumber } = req.params;
    const userId = req.resourceUserId || req.userId;

    const pageOcr = await OcrJobService.getBookPageOcr(bookId, pageNumber, userId);
    return res.status(200).json({ page: pageOcr });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/books/:bookId/ocr/jobs/:jobId/cancel
 * or POST /api/books/:bookId/ocr/cancel
 * Cancel an eligible (PENDING or PROCESSING) OCR job.
 */
export async function cancelOcrJob(req, res, next) {
  try {
    const { bookId, jobId: paramJobId } = req.params;
    const userId = req.userId;

    let jobIdToCancel = paramJobId;
    if (!jobIdToCancel) {
      // Find latest active job for book
      const status = await OcrJobService.getBookOcrStatus(bookId, userId);
      jobIdToCancel = status.latestJob?.id;
      if (!jobIdToCancel) {
        return res.status(404).json({
          error: {
            message: 'No active OCR job found to cancel.',
            code: 'NO_ACTIVE_JOB',
          },
        });
      }
    }

    const job = await OcrJobService.cancelJob(jobIdToCancel, userId);
    return res.status(200).json({
      message: 'OCR job cancelled successfully.',
      job,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/books/:bookId/ocr/retry
 * Retry missing or failed pages for an owned book.
 */
export async function retryFailedPages(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;

    const { job, isExisting } = await OcrJobService.retryFailedPages(bookId, userId);
    return res.status(202).json({
      message: 'Retry OCR job initiated for unindexed or failed pages.',
      job,
      isExisting,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ocr/health
 * Non-blocking health check against the Python OCR worker.
 */
export async function getOcrHealth(req, res, next) {
  try {
    const health = await ocrClient.checkHealth(2500);
    const statusCode = health.isHealthy ? 200 : 503;
    return res.status(statusCode).json(health);
  } catch (err) {
    next(err);
  }
}

