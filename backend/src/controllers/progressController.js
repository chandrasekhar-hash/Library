import { prisma } from '../services/prisma.js';
import { isValidUuid } from '../utils/validators.js';

/**
 * Controller for Reading Progress in Aks (अक्स)
 *
 * CRITICAL ARCHITECTURAL INVARIANT:
 * ReadingProgress is the SINGLE SOURCE OF TRUTH for current reading position.
 * - Does not create or use a current-page column on Book.
 * - Does not use bookmarks as a substitute.
 * - Uses composite unique upsert: @@unique([bookId, userId]) ensuring exactly 1 progress record per book/user.
 * - Automatically updates book.status (UNREAD -> IN_PROGRESS -> FINISHED) based on progress.
 */

function sanitizeProgress(progress) {
  if (!progress) return null;
  return {
    id: progress.id,
    bookId: progress.bookId,
    userId: progress.userId,
    currentPage: progress.currentPage,
    progressPercent: progress.progressPercent,
    lastOpenedAt: progress.lastOpenedAt,
    lastOpenedTimestamp: progress.lastOpenedTimestamp !== null && progress.lastOpenedTimestamp !== undefined
      ? Number(progress.lastOpenedTimestamp)
      : null,
    createdAt: progress.createdAt,
    updatedAt: progress.updatedAt,
  };
}

/**
 * PUT /api/books/:bookId/progress
 * Create or update the single source of truth reading position for an owned book.
 */
export async function updateReadingProgress(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;
    const { currentPage } = req.body;

    if (!isValidUuid(bookId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid book ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    // 1. Verify book existence and ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    // 2. Validate currentPage
    const pageNum = parseInt(currentPage, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: {
          message: 'currentPage must be an integer greater than or equal to 1.',
          code: 'INVALID_CURRENT_PAGE',
        },
      });
    }

    if (book.totalPages > 0 && pageNum > book.totalPages) {
      return res.status(400).json({
        error: {
          message: `currentPage (${pageNum}) cannot exceed the book total pages (${book.totalPages}).`,
          code: 'PAGE_EXCEEDS_TOTAL',
        },
      });
    }

    // 3. Calculate progress percentage
    const total = Math.max(1, book.totalPages);
    const progressPercent = Math.min(100, Math.round((pageNum / total) * 10000) / 100);

    const now = new Date();
    const timestampBigInt = BigInt(Date.now());

    // 4. Atomic upsert to guarantee a single record per book/user
    const progress = await prisma.readingProgress.upsert({
      where: {
        bookId_userId: {
          bookId,
          userId,
        },
      },
      update: {
        currentPage: pageNum,
        progressPercent,
        lastOpenedAt: now,
        lastOpenedTimestamp: timestampBigInt,
      },
      create: {
        bookId,
        userId,
        currentPage: pageNum,
        progressPercent,
        lastOpenedAt: now,
        lastOpenedTimestamp: timestampBigInt,
      },
    });

    // 5. Update book status if applicable (without touching bookmarks or creating separate page columns)
    let newStatus = book.status;
    if (pageNum >= total) {
      newStatus = 'FINISHED';
    } else if (pageNum > 1 || book.status === 'FINISHED') {
      newStatus = 'IN_PROGRESS';
    }

    if (newStatus !== book.status) {
      await prisma.book.update({
        where: { id_userId: { id: bookId, userId } },
        data: { status: newStatus },
      });
    }

    return res.status(200).json({
      message: 'Reading progress updated successfully.',
      progress: sanitizeProgress(progress),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/progress
 * Retrieve the current single source of truth reading position for an owned book.
 */
export async function getReadingProgress(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(bookId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid book ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    // Verify book ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const progress = await prisma.readingProgress.findUnique({
      where: {
        bookId_userId: {
          bookId,
          userId,
        },
      },
    });

    if (!progress) {
      // Return default position (page 1, 0%) for unread volume
      return res.status(200).json({
        progress: {
          id: null,
          bookId,
          userId,
          currentPage: 1,
          progressPercent: 0,
          lastOpenedAt: null,
          lastOpenedTimestamp: null,
          createdAt: null,
          updatedAt: null,
        },
      });
    }

    return res.status(200).json({
      progress: sanitizeProgress(progress),
    });
  } catch (err) {
    next(err);
  }
}
