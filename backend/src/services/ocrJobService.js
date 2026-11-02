/**
 * OCR Job Management and Orchestration Service for Aks (अक्स)
 *
 * Implements:
 * - Secure Node.js-to-Python OCR job lifecycle
 * - Hybrid extraction (native PDF text check first, PaddleOCR fallback)
 * - Multi-tenant isolation at database level
 * - Concurrency limit handling (HTTP 429 backoff)
 * - Database-backed recovery across backend restarts
 * - Preserves raw text and bounding boxes independently of normalized search tokens
 */

import { prisma } from './prisma.js';
import { resolveSafeStoragePath } from './storageService.js';
import { NativeTextExtractor } from './nativeTextExtractor.js';
import { ocrClient, OcrClientError } from './ocrClient.js';
import { DevanagariSearchNormalizer } from '../utils/devanagariNormalizer.js';

// In-memory set of currently running job IDs in this Node process
const activeRunningJobIds = new Set();

/**
 * Sanitizes an OcrJob record for JSON responses.
 */
export function sanitizeOcrJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    bookId: job.bookId,
    status: job.status,
    language: job.language,
    totalPages: job.totalPages,
    processedPages: job.processedPages,
    failedPages: job.failedPages,
    nativePages: job.nativePages,
    ocrPages: job.ocrPages,
    errorMessage: job.errorMessage,
    errorDetails: job.errorDetails,
    idempotencyKey: job.idempotencyKey,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
  };
}

export class OcrJobService {
  /**
   * Request OCR processing for an owned book.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.bookId
   * @param {string} [params.language='en']
   * @param {boolean} [params.force=false] - Force re-OCR even if native text exists
   * @param {string} [params.idempotencyKey]
   * @returns {Promise<Object>} Created or existing OcrJob record
   */
  static async requestJob({ userId, bookId, language = 'en', force = false, idempotencyKey = null }) {
    if (!userId || !bookId) {
      throw new Error('userId and bookId are required to request an OCR job.');
    }

    // 1. Verify book exists and is owned by the authenticated user
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: { file: true },
    });

    if (!book) {
      const err = new Error('Book not found or access denied.');
      err.statusCode = 404;
      err.code = 'BOOK_NOT_FOUND';
      throw err;
    }

    if (!book.file) {
      const err = new Error('Book has no attached PDF file to process.');
      err.statusCode = 400;
      err.code = 'BOOK_FILE_MISSING';
      throw err;
    }

    // 2. Check idempotency key if provided
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
      const existingByIdempotency = await prisma.ocrJob.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: idempotencyKey.trim(),
          },
        },
      });

      if (existingByIdempotency) {
        return {
          job: sanitizeOcrJob(existingByIdempotency),
          isExisting: true,
        };
      }
    }

    // 3. Prevent duplicate active jobs for the same book
    const existingActiveJob = await prisma.ocrJob.findFirst({
      where: {
        bookId,
        userId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingActiveJob) {
      return {
        job: sanitizeOcrJob(existingActiveJob),
        isExisting: true,
      };
    }

    // 4. Create new OcrJob record with PENDING status
    const newJob = await prisma.ocrJob.create({
      data: {
        userId,
        bookId,
        language: language || 'en',
        status: 'PENDING',
        totalPages: book.totalPages || 0,
        idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
      },
    });

    // 5. Trigger sequential processing for this user via IndexingQueueService
    import('./indexingQueueService.js').then(({ IndexingQueueService }) => {
      IndexingQueueService.processUserQueue(userId);
    }).catch((e) => {
      console.error('[OcrJobService] Failed to notify IndexingQueueService:', e);
    });

    return {
      job: sanitizeOcrJob(newJob),
      isExisting: false,
    };
  }

  /**
   * Execute an OCR job in the background.
   *
   * @param {string} jobId
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   */
  static async executeJob(jobId, options = {}) {
    if (activeRunningJobIds.has(jobId)) {
      return;
    }
    activeRunningJobIds.add(jobId);

    let job = null;
    try {
      job = await prisma.ocrJob.findUnique({
        where: { id: jobId },
        include: {
          book: {
            include: { file: true },
          },
        },
      });

      if (!job || job.status === 'CANCELLED' || job.status === 'COMPLETED') {
        return;
      }

      if (!job.book || !job.book.file) {
        await prisma.ocrJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorMessage: 'Attached PDF file record missing or deleted.',
            completedAt: new Date(),
          },
        });
        return;
      }

      // Mark job as PROCESSING
      await prisma.ocrJob.update({
        where: { id: jobId },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
        },
      });

      const pdfPath = resolveSafeStoragePath(job.book.file.storagePath);

      // Determine total pages
      let totalPages = job.totalPages;
      if (!totalPages || totalPages <= 0) {
        try {
          totalPages = await NativeTextExtractor.getPageCount(pdfPath);
          await prisma.ocrJob.update({
            where: { id: jobId },
            data: { totalPages },
          });
        } catch (err) {
          await prisma.ocrJob.update({
            where: { id: jobId },
            data: {
              status: 'FAILED',
              errorMessage: `Failed to inspect PDF: ${err.message}`,
              completedAt: new Date(),
            },
          });
          return;
        }
      }

      let processedCount = 0;
      let failedCount = 0;
      let nativeCount = 0;
      let ocrCount = 0;
      let blankCount = 0;

      // Process page-by-page sequentially to ensure memory bounding
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        // Check if job was cancelled during execution
        const checkJob = await prisma.ocrJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });

        if (checkJob?.status === 'CANCELLED') {
          break;
        }

        try {
          // STEP 0: If not forcing, check if page is already indexed
          if (!options.force) {
            const existingRecord = await prisma.bookPageOcr.findUnique({
              where: {
                bookId_pageNumber_userId: {
                  bookId: job.bookId,
                  pageNumber: pageNum,
                  userId: job.userId,
                },
              },
              select: {
                source: true,
                lineCount: true,
                rawText: true,
              },
            });

            if (existingRecord) {
              processedCount++;
              if (existingRecord.lineCount === 0 && (!existingRecord.rawText || existingRecord.rawText.trim() === '')) {
                blankCount++;
              } else if (existingRecord.source === 'NATIVE') {
                nativeCount++;
              } else {
                ocrCount++;
              }
              continue;
            }
          }

          // STEP 1: Attempt native PDF text extraction first
          let nativeExtracted = null;
          try {
            nativeExtracted = await NativeTextExtractor.extractPageText(pdfPath, pageNum);
          } catch (err) {
            console.warn(`[OcrJobService] Native extraction error on page ${pageNum}:`, err.message);
          }

          // STEP 2: If native text is usable, persist and skip heavy OCR
          if (nativeExtracted && nativeExtracted.isUsable) {
            const searchTokens = DevanagariSearchNormalizer.toSearchTokens(nativeExtracted.rawText);

            await prisma.bookPageOcr.upsert({
              where: {
                bookId_pageNumber_userId: {
                  bookId: job.bookId,
                  pageNumber: pageNum,
                  userId: job.userId,
                },
              },
              create: {
                userId: job.userId,
                bookId: job.bookId,
                pageNumber: pageNum,
                source: 'NATIVE',
                rawText: nativeExtracted.rawText,
                searchTokens,
                normalizerVersion: DevanagariSearchNormalizer.VERSION,
                language: job.language,
                confidence: 1.0,
                lineCount: nativeExtracted.lineCount,
                detectedRotation: 0,
                bboxData: nativeExtracted.lines,
                metadata: {
                  width: nativeExtracted.width,
                  height: nativeExtracted.height,
                  source: 'native_pdfjs',
                },
              },
              update: {
                source: 'NATIVE',
                rawText: nativeExtracted.rawText,
                searchTokens,
                normalizerVersion: DevanagariSearchNormalizer.VERSION,
                language: job.language,
                confidence: 1.0,
                lineCount: nativeExtracted.lineCount,
                detectedRotation: 0,
                bboxData: nativeExtracted.lines,
                metadata: {
                  width: nativeExtracted.width,
                  height: nativeExtracted.height,
                  source: 'native_pdfjs',
                },
              },
            });

            processedCount++;
            nativeCount++;
          } else {
            // STEP 3: Request OCR for page with missing or insufficient text
            let ocrResult = null;
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount <= maxRetries) {
              try {
                ocrResult = await ocrClient.processPdf({
                  pdfPath,
                  lang: job.language,
                  startPage: pageNum - 1, // Python worker is 0-indexed
                  maxPages: 1,
                  isolated: true,
                });
                break; // Succeeded
              } catch (ocrErr) {
                if (ocrErr instanceof OcrClientError && ocrErr.statusCode === 429) {
                  // Concurrency limit reached on Python worker: back off and retry
                  const waitSeconds = ocrErr.retryAfter || 5;
                  console.warn(
                    `[OcrJobService] OCR worker 429 received on page ${pageNum}. Backing off for ${waitSeconds}s (retry ${retryCount + 1}/${maxRetries})...`
                  );
                  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
                  retryCount++;
                  if (retryCount > maxRetries) {
                    throw ocrErr;
                  }
                } else {
                  throw ocrErr;
                }
              }
            }

            const pageOcr = ocrResult?.pages?.[0];
            if (!pageOcr || pageOcr.error) {
              throw new Error(pageOcr?.error || 'Page OCR returned empty results');
            }

            const rawText = (pageOcr.lines || []).map((l) => l.text).join('\n');
            const isBlank = rawText.trim().length === 0;
            const searchTokens = isBlank ? [] : DevanagariSearchNormalizer.toSearchTokens(rawText);

            await prisma.bookPageOcr.upsert({
              where: {
                bookId_pageNumber_userId: {
                  bookId: job.bookId,
                  pageNumber: pageNum,
                  userId: job.userId,
                },
              },
              create: {
                userId: job.userId,
                bookId: job.bookId,
                pageNumber: pageNum,
                source: 'OCR',
                rawText: isBlank ? '' : rawText,
                searchTokens,
                normalizerVersion: DevanagariSearchNormalizer.VERSION,
                language: job.language,
                confidence: isBlank ? 1.0 : (pageOcr.average_confidence ?? null),
                lineCount: isBlank ? 0 : (pageOcr.line_count || pageOcr.lines?.length || 0),
                detectedRotation: pageOcr.detected_rotation || 0,
                bboxData: isBlank ? [] : (pageOcr.lines || []),
                metadata: {
                  width: pageOcr.width,
                  height: pageOcr.height,
                  dpi: pageOcr.dpi,
                  duration_ms: pageOcr.duration_ms,
                  cold_start: pageOcr.cold_start,
                  isBlank,
                  reason: isBlank ? 'no_text_detected' : undefined,
                  source: isBlank ? 'ocr_blank_verifier' : 'paddle_ocr',
                },
              },
              update: {
                source: 'OCR',
                rawText: isBlank ? '' : rawText,
                searchTokens,
                normalizerVersion: DevanagariSearchNormalizer.VERSION,
                language: job.language,
                confidence: isBlank ? 1.0 : (pageOcr.average_confidence ?? null),
                lineCount: isBlank ? 0 : (pageOcr.line_count || pageOcr.lines?.length || 0),
                detectedRotation: pageOcr.detected_rotation || 0,
                bboxData: isBlank ? [] : (pageOcr.lines || []),
                metadata: {
                  width: pageOcr.width,
                  height: pageOcr.height,
                  dpi: pageOcr.dpi,
                  duration_ms: pageOcr.duration_ms,
                  cold_start: pageOcr.cold_start,
                  isBlank,
                  reason: isBlank ? 'no_text_detected' : undefined,
                  source: isBlank ? 'ocr_blank_verifier' : 'paddle_ocr',
                },
              },
            });

            processedCount++;
            if (isBlank) {
              blankCount++;
            } else {
              ocrCount++;
            }
          }
        } catch (pageError) {
          failedCount++;
          console.error(`[OcrJobService] Failed to process page ${pageNum} for book ${job.bookId}:`, pageError.message);
        }

        // Periodically update progress in PostgreSQL
        await prisma.ocrJob.update({
          where: { id: jobId },
          data: {
            processedPages: processedCount,
            failedPages: failedCount,
            nativePages: nativeCount,
            ocrPages: ocrCount,
          },
        });
      }

      // Check final status
      const finalCheck = await prisma.ocrJob.findUnique({
        where: { id: jobId },
      });

      if (finalCheck?.status !== 'CANCELLED') {
        const finalStatus = (failedCount > 0 && processedCount === 0) ? 'FAILED' : 'COMPLETED';
        const errorMessage = (failedCount > 0 && processedCount === 0)
          ? `All ${failedCount} pages failed processing.`
          : (failedCount > 0 ? `${failedCount} pages failed processing.` : null);

        await prisma.ocrJob.update({
          where: { id: jobId },
          data: {
            status: finalStatus,
            processedPages: processedCount,
            failedPages: failedCount,
            nativePages: nativeCount,
            ocrPages: ocrCount,
            errorMessage,
            completedAt: new Date(),
          },
        });
      }
    } catch (jobErr) {
      console.error(`[OcrJobService] Unhandled error during OCR job ${jobId}:`, jobErr);
      await prisma.ocrJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorMessage: jobErr.message || 'Internal error during job execution',
          completedAt: new Date(),
        },
      });
    } finally {
      activeRunningJobIds.delete(jobId);
      if (job?.userId) {
        import('./indexingQueueService.js').then(({ IndexingQueueService }) => {
          IndexingQueueService.notifyJobFinished(job.userId, jobId);
        }).catch(() => {});
      }
    }
  }

  /**
   * Recovers jobs that were interrupted by a server restart or left pending.
   */
  static async recoverDanglingJobs() {
    try {
      const { IndexingQueueService } = await import('./indexingQueueService.js');
      await IndexingQueueService.recoverQueueOnBoot();
    } catch (err) {
      console.error('[OcrJobService] Error recovering dangling jobs on boot:', err);
    }
  }

  /**
   * Retrieve OCR job status by jobId and userId.
   */
  static async getJobStatus(jobId, userId) {
    const job = await prisma.ocrJob.findFirst({
      where: { id: jobId, userId },
    });

    if (!job) {
      const err = new Error('OCR job not found or access denied.');
      err.statusCode = 404;
      err.code = 'OCR_JOB_NOT_FOUND';
      throw err;
    }

    return sanitizeOcrJob(job);
  }

  /**
   * Retrieve latest OCR status and page coverage for an owned book.
   */
  static async getBookOcrStatus(bookId, userId) {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: { file: true },
    });

    if (!book) {
      const err = new Error('Book not found or access denied.');
      err.statusCode = 404;
      err.code = 'BOOK_NOT_FOUND';
      throw err;
    }

    const latestJob = await prisma.ocrJob.findFirst({
      where: { bookId, userId },
      orderBy: { createdAt: 'desc' },
    });

    const pageCount = await prisma.bookPageOcr.count({
      where: { bookId, userId },
    });

    const nativeCount = await prisma.bookPageOcr.count({
      where: { bookId, userId, source: 'NATIVE', lineCount: { gt: 0 } },
    });

    const ocrCount = await prisma.bookPageOcr.count({
      where: { bookId, userId, source: 'OCR', lineCount: { gt: 0 } },
    });

    const blankCount = await prisma.bookPageOcr.count({
      where: {
        bookId,
        userId,
        lineCount: 0,
        rawText: '',
      },
    });

    const unindexedPages = Math.max(0, book.totalPages - pageCount);
    const failedPages = latestJob?.failedPages || 0;
    const isFullyIndexed = book.totalPages > 0 ? pageCount >= book.totalPages : pageCount > 0;
    const canRetry = failedPages > 0 || (unindexedPages > 0 && (!latestJob || latestJob.status === 'COMPLETED' || latestJob.status === 'FAILED'));

    return {
      bookId,
      totalPages: book.totalPages,
      hasFile: Boolean(book.file),
      indexedPages: pageCount,
      nativePages: nativeCount,
      ocrPages: ocrCount,
      blankPages: blankCount,
      failedPages,
      unindexedPages,
      isFullyIndexed,
      canRetry,
      latestJob: sanitizeOcrJob(latestJob),
    };
  }

  /**
   * Retrieve page-level OCR results for an owned book.
   */
  static async getBookPageOcr(bookId, pageNumber, userId) {
    const pageNum = parseInt(pageNumber, 10);
    if (Number.isNaN(pageNum) || pageNum < 1) {
      const err = new Error('Valid 1-based pageNumber is required.');
      err.statusCode = 400;
      err.code = 'INVALID_PAGE_NUMBER';
      throw err;
    }

    const pageOcr = await prisma.bookPageOcr.findUnique({
      where: {
        bookId_pageNumber_userId: {
          bookId,
          pageNumber: pageNum,
          userId,
        },
      },
    });

    if (!pageOcr) {
      const err = new Error(`OCR record for page ${pageNum} not found.`);
      err.statusCode = 404;
      err.code = 'PAGE_OCR_NOT_FOUND';
      throw err;
    }

    return pageOcr;
  }

  /**
   * Retrieve all page-level OCR records for an owned book (paginated or full list).
   */
  static async listBookPagesOcr(bookId, userId) {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!book) {
      const err = new Error('Book not found or access denied.');
      err.statusCode = 404;
      err.code = 'BOOK_NOT_FOUND';
      throw err;
    }

    const pages = await prisma.bookPageOcr.findMany({
      where: { bookId, userId },
      orderBy: { pageNumber: 'asc' },
      select: {
        id: true,
        pageNumber: true,
        source: true,
        language: true,
        confidence: true,
        lineCount: true,
        detectedRotation: true,
        normalizerVersion: true,
        searchTokens: true,
        rawText: true,
        bboxData: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return pages;
  }

  /**
   * Cancel an eligible OCR job (PENDING or PROCESSING).
   */
  static async cancelJob(jobId, userId) {
    const job = await prisma.ocrJob.findFirst({
      where: { id: jobId, userId },
    });

    if (!job) {
      const err = new Error('OCR job not found or access denied.');
      err.statusCode = 404;
      err.code = 'OCR_JOB_NOT_FOUND';
      throw err;
    }

    if (job.status !== 'PENDING' && job.status !== 'PROCESSING') {
      const err = new Error(`Cannot cancel job with status ${job.status}.`);
      err.statusCode = 400;
      err.code = 'JOB_NOT_CANCELLABLE';
      throw err;
    }

    const updated = await prisma.ocrJob.update({
      where: { id: jobId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    return sanitizeOcrJob(updated);
  }

  /**
   * Retry failed or missing pages for an owned book.
   */
  static async retryFailedPages(bookId, userId) {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: { file: true },
    });

    if (!book || !book.file) {
      const err = new Error('Book or attached file not found or access denied.');
      err.statusCode = 404;
      err.code = 'BOOK_NOT_FOUND';
      throw err;
    }

    // Identify which pages already have BookPageOcr records
    const existingPages = await prisma.bookPageOcr.findMany({
      where: { bookId, userId },
      select: { pageNumber: true },
    });

    const existingPageSet = new Set(existingPages.map((p) => p.pageNumber));
    const missingPages = [];
    for (let p = 1; p <= book.totalPages; p++) {
      if (!existingPageSet.has(p)) {
        missingPages.push(p);
      }
    }

    // Request new OCR job
    return await this.requestJob({
      userId,
      bookId,
      force: false,
    });
  }
}

