import { prisma } from '../services/prisma.js';
import { isValidUuid, SUPPORTED_ANNOTATION_COLORS } from '../utils/validators.js';

/**
 * Controller for Bookmarks in Aks (अक्स)
 *
 * Enforces:
 * - Scoped ownership (userId and bookId)
 * - Validation of page numbers against book totalPages
 * - Duplicate bookmark prevention on same page
 * - Independence from reading progress
 */

/**
 * POST /api/books/:bookId/bookmarks
 * Create a bookmark on a specific page of an owned book.
 */
export async function createBookmark(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;
    const { page, label, color, sourceId } = req.body;

    const cleanSourceId = typeof sourceId === 'string' && sourceId.trim().length > 0
      ? sourceId.trim().slice(0, 100)
      : null;

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

    // Check migration sourceId idempotency first
    if (cleanSourceId) {
      const existingBySource = await prisma.bookmark.findFirst({
        where: { sourceId: cleanSourceId, userId },
      });
      if (existingBySource) {
        return res.status(200).json({
          message: 'Bookmark already exists for this migration source ID (idempotent create).',
          bookmark: existingBySource,
          isExisting: true,
        });
      }
    }

    // 2. Validate page number
    const parsedPage = parseInt(page, 10);
    if (isNaN(parsedPage) || parsedPage < 1) {
      return res.status(400).json({
        error: {
          message: 'A valid page number greater than or equal to 1 is required.',
          code: 'INVALID_PAGE',
        },
      });
    }

    if (book.totalPages > 0 && parsedPage > book.totalPages) {
      return res.status(400).json({
        error: {
          message: `Page ${parsedPage} exceeds the book total pages (${book.totalPages}).`,
          code: 'PAGE_EXCEEDS_TOTAL',
        },
      });
    }

    // 3. Validate optional label and color
    const bookmarkLabel = typeof label === 'string' && label.trim().length > 0
      ? label.trim().slice(0, 100)
      : `Page ${parsedPage}`;

    let bookmarkColor = 'gold';
    if (color !== undefined) {
      if (typeof color !== 'string' || !SUPPORTED_ANNOTATION_COLORS.includes(color.trim().toLowerCase())) {
        return res.status(400).json({
          error: {
            message: `Invalid bookmark color. Allowed colors: ${SUPPORTED_ANNOTATION_COLORS.join(', ')}`,
            code: 'INVALID_COLOR',
          },
        });
      }
      bookmarkColor = color.trim().toLowerCase();
    }

    // 4. Check for duplicate bookmark on the same page
    const existing = await prisma.bookmark.findUnique({
      where: {
        bookId_page_userId: {
          bookId,
          page: parsedPage,
          userId,
        },
      },
    });

    if (existing) {
      if (cleanSourceId && existing.sourceId === cleanSourceId) {
        return res.status(200).json({
          message: 'Bookmark already exists for this migration source ID (idempotent create).',
          bookmark: existing,
          isExisting: true,
        });
      }
      return res.status(409).json({
        error: {
          message: `A bookmark already exists on page ${parsedPage} for this book.`,
          code: 'BOOKMARK_ALREADY_EXISTS',
        },
      });
    }

    // 5. Create bookmark record
    const bookmark = await prisma.bookmark.create({
      data: {
        bookId,
        userId,
        page: parsedPage,
        label: bookmarkLabel,
        color: bookmarkColor,
        sourceId: cleanSourceId || null,
      },
    });

    return res.status(201).json({
      message: 'Bookmark created successfully.',
      bookmark,
    });
  } catch (err) {
    if (err.code === 'P2002' && req.body?.sourceId) {
      const existing = await prisma.bookmark.findFirst({
        where: { sourceId: String(req.body.sourceId).trim(), userId: req.userId },
      });
      if (existing) {
        return res.status(200).json({
          message: 'Bookmark already exists for this migration source ID (idempotent create).',
          bookmark: existing,
          isExisting: true,
        });
      }
    }
    next(err);
  }
}

/**
 * GET /api/books/:bookId/bookmarks
 * List all bookmarks for a specific owned book.
 */
export async function listBookmarks(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.resourceUserId || req.userId;

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

    const bookmarks = await prisma.bookmark.findMany({
      where: {
        bookId,
        userId,
      },
      orderBy: { page: 'asc' },
    });

    return res.status(200).json({
      bookmarks,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/bookmarks/:bookmarkId
 * Update label or color of an existing owned bookmark.
 */
export async function updateBookmark(req, res, next) {
  try {
    const { bookmarkId } = req.params;
    const userId = req.userId;
    const { label, color } = req.body;

    if (!isValidUuid(bookmarkId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid bookmark ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Bookmark not found or access denied.',
          code: 'BOOKMARK_NOT_FOUND',
        },
      });
    }

    const updateData = {};

    if (label !== undefined) {
      if (typeof label !== 'string' || label.trim().length === 0) {
        return res.status(400).json({
          error: {
            message: 'Bookmark label cannot be empty.',
            code: 'INVALID_LABEL',
          },
        });
      }
      updateData.label = label.trim().slice(0, 100);
    }

    if (color !== undefined) {
      if (typeof color !== 'string' || !SUPPORTED_ANNOTATION_COLORS.includes(color.trim().toLowerCase())) {
        return res.status(400).json({
          error: {
            message: `Invalid bookmark color. Allowed colors: ${SUPPORTED_ANNOTATION_COLORS.join(', ')}`,
            code: 'INVALID_COLOR',
          },
        });
      }
      updateData.color = color.trim().toLowerCase();
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: {
          message: 'No valid fields provided for bookmark update.',
          code: 'NO_FIELDS_TO_UPDATE',
        },
      });
    }

    const updated = await prisma.bookmark.update({
      where: { id: bookmarkId },
      data: updateData,
    });

    return res.status(200).json({
      message: 'Bookmark updated successfully.',
      bookmark: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/bookmarks/:bookmarkId
 * Delete an owned bookmark.
 */
export async function deleteBookmark(req, res, next) {
  try {
    const { bookmarkId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(bookmarkId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid bookmark ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Bookmark not found or access denied.',
          code: 'BOOKMARK_NOT_FOUND',
        },
      });
    }

    await prisma.bookmark.delete({
      where: { id: bookmarkId },
    });

    return res.status(200).json({
      message: 'Bookmark deleted successfully.',
      id: bookmarkId,
    });
  } catch (err) {
    next(err);
  }
}
