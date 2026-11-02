import { prisma } from '../services/prisma.js';
import { deleteStoredFile } from '../services/storageService.js';
import { isValidUuid, parsePagination } from '../utils/validators.js';
import { withBookLock } from '../utils/bookLock.js';

const VALID_BOOK_STATUSES = ['UNREAD', 'IN_PROGRESS', 'FINISHED'];
const VALID_SORT_FIELDS = ['title', 'author', 'createdAt', 'updatedAt', 'status'];

/**
 * Sanitizes book objects for JSON responses, converting BigInt fields to numbers
 * and ensuring internal storage paths are never leaked.
 */
export function sanitizeBook(book) {
  if (!book) return null;
  const sanitized = { ...book };
  if (sanitized.file) {
    sanitized.file = {
      id: sanitized.file.id,
      filename: sanitized.file.filename,
      mimeType: sanitized.file.mimeType,
      fileSizeBytes: Number(sanitized.file.fileSizeBytes),
      fileSha256: sanitized.file.fileSha256,
      createdAt: sanitized.file.createdAt,
      updatedAt: sanitized.file.updatedAt,
    };
  }
  return sanitized;
}

/**
 * POST /api/books
 * Create a new book record owned by the authenticated user.
 */
export async function createBook(req, res, next) {
  try {
    const userId = req.userId;
    const { title, author, category, format, totalPages, colorScheme, sourceId } = req.body;

    const trimmedSourceId = typeof sourceId === 'string' && sourceId.trim().length > 0
      ? sourceId.trim().slice(0, 100)
      : null;

    if (trimmedSourceId) {
      const existingBySource = await prisma.book.findFirst({
        where: { sourceId: trimmedSourceId, userId },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              fileSizeBytes: true,
              fileSha256: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          readingProgress: {
            select: {
              currentPage: true,
              progressPercent: true,
              lastOpenedAt: true,
            },
          },
          _count: {
            select: {
              bookmarks: true,
              notes: true,
              highlights: true,
            },
          },
        },
      });

      if (existingBySource) {
        return res.status(200).json({
          message: 'Book already exists for this migration source ID (idempotent create).',
          book: sanitizeBook(existingBySource),
          isExisting: true,
        });
      }
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        error: {
          message: 'Book title is required and cannot be empty.',
          code: 'TITLE_REQUIRED',
        },
      });
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 255) {
      return res.status(400).json({
        error: {
          message: 'Book title must not exceed 255 characters.',
          code: 'TITLE_TOO_LONG',
        },
      });
    }

    let parsedTotalPages = 1;
    if (totalPages !== undefined && totalPages !== null) {
      parsedTotalPages = parseInt(totalPages, 10);
      if (isNaN(parsedTotalPages) || parsedTotalPages < 1) {
        return res.status(400).json({
          error: {
            message: 'totalPages must be an integer greater than or equal to 1.',
            code: 'INVALID_TOTAL_PAGES',
          },
        });
      }
    }

    const trimmedAuthor = typeof author === 'string' && author.trim().length > 0
      ? author.trim().slice(0, 255)
      : 'Aks Edition';

    const trimmedCategory = typeof category === 'string' && category.trim().length > 0
      ? category.trim().slice(0, 100)
      : 'General';

    const trimmedFormat = typeof format === 'string' && format.trim().length > 0
      ? format.trim().slice(0, 50)
      : 'PDF';

    const book = await prisma.book.create({
      data: {
        userId,
        title: trimmedTitle,
        author: trimmedAuthor,
        category: trimmedCategory,
        format: trimmedFormat,
        totalPages: parsedTotalPages,
        colorScheme: colorScheme && typeof colorScheme === 'object' ? colorScheme : null,
        sourceId: trimmedSourceId || null,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            mimeType: true,
            fileSizeBytes: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        readingProgress: {
          select: {
            currentPage: true,
            progressPercent: true,
            lastOpenedAt: true,
          },
        },
        _count: {
          select: {
            bookmarks: true,
            notes: true,
            highlights: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: 'Book created successfully.',
      book: sanitizeBook(book),
    });
  } catch (err) {
    if (err.code === 'P2002' && req.body?.sourceId) {
      const existing = await prisma.book.findFirst({
        where: { sourceId: String(req.body.sourceId).trim(), userId: req.userId },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              fileSizeBytes: true,
              fileSha256: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          readingProgress: {
            select: {
              currentPage: true,
              progressPercent: true,
              lastOpenedAt: true,
            },
          },
          _count: {
            select: {
              bookmarks: true,
              notes: true,
              highlights: true,
            },
          },
        },
      });
      if (existing) {
        return res.status(200).json({
          message: 'Book already exists for this migration source ID (idempotent create).',
          book: sanitizeBook(existing),
          isExisting: true,
        });
      }
    }
    next(err);
  }
}

/**
 * GET /api/books
 * List books belonging to the authenticated user with pagination and filtering.
 */
export async function listBooks(req, res, next) {
  try {
    const userId = req.userId;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { userId };

    // Optional category filtering
    if (req.query.category && typeof req.query.category === 'string') {
      where.category = req.query.category.trim();
    }

    // Optional status filtering
    if (req.query.status && typeof req.query.status === 'string') {
      const statusUpper = req.query.status.trim().toUpperCase();
      if (VALID_BOOK_STATUSES.includes(statusUpper)) {
        where.status = statusUpper;
      }
    }

    // Optional search filtering by title or author
    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim().length > 0) {
      const search = req.query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { author: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Sorting
    let sortBy = 'updatedAt';
    if (req.query.sortBy && VALID_SORT_FIELDS.includes(req.query.sortBy)) {
      sortBy = req.query.sortBy;
    }

    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [totalCount, books] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              fileSizeBytes: true,
              fileSha256: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          readingProgress: {
            select: {
              currentPage: true,
              progressPercent: true,
              lastOpenedAt: true,
            },
          },
          _count: {
            select: {
              bookmarks: true,
              notes: true,
              highlights: true,
            },
          },
        },
      }),
    ]);

    const sanitizedBooks = books.map(sanitizeBook);
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      books: sanitizedBooks,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: skip + limit < totalCount,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId
 * Retrieve a single book owned by the authenticated user.
 */
export async function getBook(req, res, next) {
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

    const book = await prisma.book.findFirst({
      where: {
        id: bookId,
        userId,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            mimeType: true,
            fileSizeBytes: true,
            fileSha256: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        readingProgress: {
          select: {
            currentPage: true,
            progressPercent: true,
            lastOpenedAt: true,
          },
        },
        _count: {
          select: {
            bookmarks: true,
            notes: true,
            highlights: true,
          },
        },
      },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    return res.status(200).json({
      book: sanitizeBook(book),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/books/:bookId
 * Update editable metadata of an owned book.
 */
export async function updateBook(req, res, next) {
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

    // Verify ownership
    const existing = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const updateData = {};
    const { title, author, category, format, totalPages, status, colorScheme } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: {
            message: 'Book title cannot be empty.',
            code: 'INVALID_TITLE',
          },
        });
      }
      if (title.trim().length > 255) {
        return res.status(400).json({
          error: {
            message: 'Book title must not exceed 255 characters.',
            code: 'TITLE_TOO_LONG',
          },
        });
      }
      updateData.title = title.trim();
    }

    if (author !== undefined) {
      updateData.author = typeof author === 'string' && author.trim().length > 0
        ? author.trim().slice(0, 255)
        : 'Aks Edition';
    }

    if (category !== undefined) {
      updateData.category = typeof category === 'string' && category.trim().length > 0
        ? category.trim().slice(0, 100)
        : 'General';
    }

    if (format !== undefined) {
      updateData.format = typeof format === 'string' && format.trim().length > 0
        ? format.trim().slice(0, 50)
        : 'PDF';
    }

    if (totalPages !== undefined) {
      const parsedPages = parseInt(totalPages, 10);
      if (isNaN(parsedPages) || parsedPages < 1) {
        return res.status(400).json({
          error: {
            message: 'totalPages must be an integer greater than or equal to 1.',
            code: 'INVALID_TOTAL_PAGES',
          },
        });
      }
      updateData.totalPages = parsedPages;
    }

    if (status !== undefined) {
      if (typeof status !== 'string' || !VALID_BOOK_STATUSES.includes(status.trim().toUpperCase())) {
        return res.status(400).json({
          error: {
            message: `Invalid book status. Allowed values: ${VALID_BOOK_STATUSES.join(', ')}`,
            code: 'INVALID_STATUS',
          },
        });
      }
      updateData.status = status.trim().toUpperCase();
    }

    if (colorScheme !== undefined) {
      updateData.colorScheme = colorScheme && typeof colorScheme === 'object' ? colorScheme : null;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: {
          message: 'No valid editable fields were provided in the update payload.',
          code: 'NO_FIELDS_TO_UPDATE',
        },
      });
    }

    const updated = await prisma.book.update({
      where: {
        id_userId: {
          id: bookId,
          userId,
        },
      },
      data: updateData,
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            mimeType: true,
            fileSizeBytes: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        readingProgress: {
          select: {
            currentPage: true,
            progressPercent: true,
            lastOpenedAt: true,
          },
        },
        _count: {
          select: {
            bookmarks: true,
            notes: true,
            highlights: true,
          },
        },
      },
    });

    return res.status(200).json({
      message: 'Book updated successfully.',
      book: sanitizeBook(updated),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/books/:bookId
 * Delete an owned book, cascading to dependent metadata, and safely cleaning up its physical PDF file.
 */
export async function deleteBook(req, res, next) {
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

    return await withBookLock(bookId, async () => {
      // 1. Re-read the latest book/file state inside the lock before deleting
      const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
        include: { file: true },
      });

      if (!book) {
        return res.status(404).json({
          error: {
            message: 'Book not found or access denied.',
            code: 'BOOK_NOT_FOUND',
          },
        });
      }

      const physicalStoragePath = book.file?.storagePath || null;

      // 2. Perform database deletion first (cascades to BookFile, ReadingProgress, Bookmarks, Highlights, etc.)
      await prisma.book.delete({
        where: {
          id_userId: {
            id: bookId,
            userId,
          },
        },
      });

      // 3. Post-commit physical file cleanup (only after DB deletion succeeds)
      if (physicalStoragePath) {
        try {
          await deleteStoredFile(physicalStoragePath);
        } catch (fileErr) {
          console.error(
            `[BookDeletion] Database deletion succeeded for book ${bookId}, but physical file cleanup failed for path ${physicalStoragePath}:`,
            fileErr.message
          );
        }
      }

      return res.status(200).json({
        message: 'Book and associated data deleted successfully.',
        id: bookId,
      });
    });
  } catch (err) {
    next(err);
  }
}

