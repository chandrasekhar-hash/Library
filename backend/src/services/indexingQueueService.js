/**
 * Library-Wide Indexing and Sequential Queue Orchestrator for Aks (अक्स)
 *
 * Implements:
 * - Comprehensive discovery across all user books (PDF existence, page counts, OCR status)
 * - PostgreSQL-backed sequential job queue (concurrency: 1 per user)
 * - Non-blocking enqueueing of all eligible unindexed or partially indexed books
 * - Safe pause, resume, and retry-failed controls
 * - Strict multi-tenant isolation per authenticated userId
 * - Automatic queue recovery across server restarts
 */

import fs from 'fs';
import { prisma } from './prisma.js';
import { resolveSafeStoragePath } from './storageService.js';
import { sanitizeOcrJob } from './ocrJobService.js';

export class IndexingQueueService {
  // In-memory state maps keyed by userId
  static userQueuePausedMap = new Map();
  static userActiveJobMap = new Map();
  static userQueueProcessingLock = new Map();

  /**
   * Check if the indexing queue is currently paused for a user.
   *
   * @param {string} userId
   * @returns {boolean}
   */
  static isQueuePaused(userId) {
    return Boolean(this.userQueuePausedMap.get(userId));
  }

  /**
   * Get the ID of the job currently being executed for a user.
   *
   * @param {string} userId
   * @returns {string|null}
   */
  static getActiveJobId(userId) {
    return this.userActiveJobMap.get(userId) || null;
  }

  /**
   * Inspect all books belonging to the authenticated user and generate
   * a comprehensive library-wide indexing audit report.
   *
   * @param {string} userId
   * @returns {Promise<Object>} Summary and per-book indexing status
   */
  static async getLibraryIndexingStatus(userId) {
    if (!userId) {
      throw new Error('userId is required to inspect library indexing status.');
    }

    // 1. Fetch all books owned by the user with attached file & latest OCR job
    const books = await prisma.book.findMany({
      where: { userId },
      include: {
        file: true,
        ocrJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Fetch page-level counts by source in batch
    const pageCounts = await prisma.bookPageOcr.groupBy({
      by: ['bookId', 'source'],
      where: { userId },
      _count: { pageNumber: true },
    });

    // 3. Fetch blank page counts in batch (lineCount: 0 and empty text)
    const blankCounts = await prisma.bookPageOcr.groupBy({
      by: ['bookId'],
      where: {
        userId,
        lineCount: 0,
        rawText: '',
      },
      _count: { pageNumber: true },
    });

    const pageCountMap = new Map();
    for (const row of pageCounts) {
      const current = pageCountMap.get(row.bookId) || { total: 0, native: 0, ocr: 0 };
      const cnt = row._count.pageNumber;
      current.total += cnt;
      if (row.source === 'NATIVE') {
        current.native += cnt;
      } else if (row.source === 'OCR') {
        current.ocr += cnt;
      }
      pageCountMap.set(row.bookId, current);
    }

    const blankCountMap = new Map();
    for (const row of blankCounts) {
      blankCountMap.set(row.bookId, row._count.pageNumber);
    }

    // 4. Transform per-book statistics
    const bookStatuses = [];
    let eligibleBooksCount = 0;
    let fullyIndexedBooksCount = 0;
    let inProgressBooksCount = 0;
    let partiallyIndexedBooksCount = 0;
    let unindexedBooksCount = 0;
    let failedBooksCount = 0;
    let missingFileBooksCount = 0;

    let totalPagesSum = 0;
    let indexedPagesSum = 0;
    let nativePagesSum = 0;
    let ocrPagesSum = 0;
    let blankPagesSum = 0;
    let failedPagesSum = 0;

    for (const book of books) {
      const counts = pageCountMap.get(book.id) || { total: 0, native: 0, ocr: 0 };
      const blankCount = blankCountMap.get(book.id) || 0;
      const latestJob = book.ocrJobs?.[0] || null;

      // Verify physical PDF existence
      let physicalPdfExists = false;
      let physicalPdfSizeBytes = null;

      if (book.file?.storagePath) {
        try {
          const resolvedPath = resolveSafeStoragePath(book.file.storagePath);
          if (fs.existsSync(resolvedPath)) {
            physicalPdfExists = true;
            const stats = fs.statSync(resolvedPath);
            physicalPdfSizeBytes = stats.size;
          }
        } catch (_) {
          physicalPdfExists = false;
        }
      }

      const totalPages = book.totalPages || 0;
      const indexedPages = counts.total;
      const nativePages = counts.native;
      const ocrPages = counts.ocr;
      const unindexedPages = Math.max(0, totalPages - indexedPages);
      const failedPages = latestJob?.failedPages || 0;

      const isFullyIndexed = totalPages > 0 ? indexedPages >= totalPages : indexedPages > 0;
      const hasActiveJob = latestJob && (latestJob.status === 'PENDING' || latestJob.status === 'PROCESSING');

      // Determine book classification
      let status = 'UNINDEXED';
      if (!physicalPdfExists) {
        status = 'FILE_MISSING';
        missingFileBooksCount++;
      } else {
        eligibleBooksCount++;
        totalPagesSum += totalPages;
        indexedPagesSum += indexedPages;
        nativePagesSum += nativePages;
        ocrPagesSum += ocrPages;
        blankPagesSum += blankCount;
        failedPagesSum += failedPages;

        if (hasActiveJob) {
          status = latestJob.status; // 'PENDING' or 'PROCESSING'
          inProgressBooksCount++;
        } else if (isFullyIndexed) {
          status = 'COMPLETED';
          fullyIndexedBooksCount++;
        } else if (latestJob?.status === 'FAILED') {
          status = 'FAILED';
          failedBooksCount++;
        } else if (indexedPages > 0) {
          status = 'PARTIAL';
          partiallyIndexedBooksCount++;
        } else {
          status = 'UNINDEXED';
          unindexedBooksCount++;
        }
      }

      const canRetry = physicalPdfExists && !hasActiveJob && (failedPages > 0 || unindexedPages > 0);

      bookStatuses.push({
        bookId: book.id,
        title: book.title,
        author: book.author,
        category: book.category,
        totalPages,
        hasFile: Boolean(book.file),
        physicalPdfExists,
        fileSizeBytes: physicalPdfSizeBytes || (book.file ? Number(book.file.fileSizeBytes) : 0),
        indexedPages,
        nativePages,
        ocrPages,
        blankPages: blankCount,
        unindexedPages,
        failedPages,
        isFullyIndexed,
        status,
        canRetry,
        coveragePercent: totalPages > 0 ? Math.round((indexedPages / totalPages) * 100) : 0,
        latestJob: sanitizeOcrJob(latestJob),
      });
    }

    // 5. Get pending jobs count in persistent queue for user
    const pendingJobCount = await prisma.ocrJob.count({
      where: {
        userId,
        status: 'PENDING',
      },
    });

    const isPaused = this.isQueuePaused(userId);
    const activeJobId = this.getActiveJobId(userId);

    const overallPercent = totalPagesSum > 0 ? Math.round((indexedPagesSum / totalPagesSum) * 100) : 0;

    return {
      summary: {
        totalBooks: books.length,
        eligibleBooks: eligibleBooksCount,
        fullyIndexedBooks: fullyIndexedBooksCount,
        inProgressBooks: inProgressBooksCount,
        partiallyIndexedBooks: partiallyIndexedBooksCount,
        unindexedBooks: unindexedBooksCount,
        failedBooks: failedBooksCount,
        missingFileBooks: missingFileBooksCount,
        totalPages: totalPagesSum,
        indexedPages: indexedPagesSum,
        nativePages: nativePagesSum,
        ocrPages: ocrPagesSum,
        blankPages: blankPagesSum,
        unindexedPages: Math.max(0, totalPagesSum - indexedPagesSum),
        failedPages: failedPagesSum,
        overallPercent,
        isPaused,
        activeJobId,
        pendingJobCount,
      },
      books: bookStatuses,
    };
  }

  /**
   * Enqueue all eligible unindexed or partially indexed books for library-wide backfill.
   *
   * @param {string} userId
   * @param {Object} [options]
   * @param {string} [options.language='en']
   * @returns {Promise<Object>}
   */
  static async enqueueLibraryBackfill(userId, options = {}) {
    if (!userId) {
      throw new Error('userId is required to enqueue library backfill.');
    }

    const status = await this.getLibraryIndexingStatus(userId);
    const eligibleToQueue = status.books.filter(
      (b) => b.physicalPdfExists && !b.isFullyIndexed && b.status !== 'PENDING' && b.status !== 'PROCESSING'
    );

    const createdJobs = [];
    const skippedAlreadyIndexed = status.summary.fullyIndexedBooks;
    const skippedActive = status.summary.inProgressBooks;
    const skippedMissingFile = status.summary.missingFileBooks;

    for (const book of eligibleToQueue) {
      const job = await prisma.ocrJob.create({
        data: {
          userId,
          bookId: book.bookId,
          language: options.language || 'en',
          status: 'PENDING',
          totalPages: book.totalPages || 0,
        },
      });
      createdJobs.push(sanitizeOcrJob(job));
    }

    // Trigger sequential queue runner
    this.processUserQueue(userId);

    return {
      enqueuedCount: createdJobs.length,
      skippedCount: skippedActive + skippedMissingFile,
      alreadyIndexedCount: skippedAlreadyIndexed,
      jobs: createdJobs,
    };
  }

  /**
   * Pause the indexing queue for a user.
   * Current running page completes, but subsequent pending jobs will not start.
   *
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  static async pauseUserQueue(userId) {
    if (!userId) {
      throw new Error('userId is required to pause queue.');
    }
    this.userQueuePausedMap.set(userId, true);
    return {
      isPaused: true,
      message: 'Library indexing queue paused.',
    };
  }

  /**
   * Resume the indexing queue for a user.
   *
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  static async resumeUserQueue(userId) {
    if (!userId) {
      throw new Error('userId is required to resume queue.');
    }
    this.userQueuePausedMap.delete(userId);
    // Restart processing
    this.processUserQueue(userId);
    return {
      isPaused: false,
      message: 'Library indexing queue resumed.',
    };
  }

  /**
   * Retry failed or incomplete books across the library for a user.
   *
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  static async retryFailedLibraryJobs(userId) {
    if (!userId) {
      throw new Error('userId is required to retry failed library jobs.');
    }

    const status = await this.getLibraryIndexingStatus(userId);
    const retryableBooks = status.books.filter(
      (b) => b.canRetry && b.status !== 'PENDING' && b.status !== 'PROCESSING'
    );

    const createdJobs = [];
    for (const book of retryableBooks) {
      const job = await prisma.ocrJob.create({
        data: {
          userId,
          bookId: book.bookId,
          language: 'en',
          status: 'PENDING',
          totalPages: book.totalPages || 0,
        },
      });
      createdJobs.push(sanitizeOcrJob(job));
    }

    // Trigger sequential queue runner
    this.processUserQueue(userId);

    return {
      retriedCount: createdJobs.length,
      jobs: createdJobs,
    };
  }

  /**
   * Sequential queue runner for a specific user.
   * Enforces concurrency limit of 1 per user to protect worker resources.
   *
   * @param {string} userId
   */
  static async processUserQueue(userId) {
    if (!userId) return;

    // Mutex check to avoid race conditions
    if (this.userQueueProcessingLock.get(userId)) {
      return;
    }
    this.userQueueProcessingLock.set(userId, true);

    try {
      // 1. Check if paused
      if (this.isQueuePaused(userId)) {
        return;
      }

      // 2. Check if user already has an actively executing job in progress
      if (this.userActiveJobMap.has(userId)) {
        return;
      }

      // 3. Find the oldest PENDING job for this user
      const nextJob = await prisma.ocrJob.findFirst({
        where: {
          userId,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!nextJob) {
        return;
      }

      // 4. Mark user as actively running this job
      this.userActiveJobMap.set(userId, nextJob.id);

      // Dynamically import OcrJobService to prevent circular dependency
      const { OcrJobService } = await import('./ocrJobService.js');

      // Execute job in background
      setImmediate(async () => {
        try {
          await OcrJobService.executeJob(nextJob.id, { force: false });
        } catch (err) {
          console.error(`[IndexingQueueService] Unhandled error running job ${nextJob.id}:`, err);
        } finally {
          this.userActiveJobMap.delete(userId);
          // Advance queue to next pending job if not paused
          if (!this.isQueuePaused(userId)) {
            this.processUserQueue(userId);
          }
        }
      });
    } catch (err) {
      console.error(`[IndexingQueueService] Error in processUserQueue for user ${userId}:`, err);
    } finally {
      this.userQueueProcessingLock.delete(userId);
    }
  }

  /**
   * Called by OcrJobService when a job finishes.
   *
   * @param {string} userId
   * @param {string} jobId
   */
  static notifyJobFinished(userId, jobId) {
    if (userId) {
      if (this.userActiveJobMap.get(userId) === jobId) {
        this.userActiveJobMap.delete(userId);
      }
      if (!this.isQueuePaused(userId)) {
        setImmediate(() => {
          this.processUserQueue(userId);
        });
      }
    }
  }

  /**
   * Reconciles interrupted jobs on system startup and restarts the sequential queue
   * for each user who has pending jobs.
   */
  static async recoverQueueOnBoot() {
    try {
      // 1. Mark interrupted PROCESSING jobs as FAILED
      const interrupted = await prisma.ocrJob.updateMany({
        where: { status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          errorMessage: 'Job was interrupted by a backend server restart.',
          completedAt: new Date(),
        },
      });

      if (interrupted.count > 0) {
        console.log(`[IndexingQueueService] Reconciled ${interrupted.count} interrupted PROCESSING jobs on boot.`);
      }

      // 2. Discover distinct users with PENDING jobs
      const pendingUsers = await prisma.ocrJob.findMany({
        where: { status: 'PENDING' },
        select: { userId: true },
        distinct: ['userId'],
      });

      console.log(`[IndexingQueueService] Recovered pending queues for ${pendingUsers.length} user(s).`);

      for (const { userId } of pendingUsers) {
        this.processUserQueue(userId);
      }
    } catch (err) {
      console.error('[IndexingQueueService] Error during boot recovery:', err);
    }
  }
}

