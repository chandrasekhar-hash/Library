import { prisma } from '../services/prisma.js';
import { isValidUuid, parsePagination } from '../utils/validators.js';

const VALID_NOTE_TYPES = ['BOOK', 'STANDALONE'];
const VALID_NOTE_CATEGORIES = ['Reflection', 'Checklist', 'Analysis', 'Vocabulary'];

/**
 * Controller for Sanctuary & Volume Notes in Aks (अक्स)
 *
 * Enforces:
 * - Standalone notes vs volume-linked notes
 * - Book ownership validation when linking to a book
 * - Automatic snapshot of bookTitleSnapshot to preserve context even if volume is deleted
 * - Multi-user isolation and pagination
 */

/**
 * POST /api/notes
 * Create a new standalone note or book-associated note.
 */
export async function createNote(req, res, next) {
  try {
    const userId = req.userId;
    const {
      title,
      content,
      richContent,
      bookId,
      page,
      category,
      type,
      sourceId,
      sectionId,
      isPinned,
      journalDate,
      appearance,
      typography,
    } = req.body;

    const cleanSourceId = typeof sourceId === 'string' && sourceId.trim().length > 0
      ? sourceId.trim().slice(0, 100)
      : null;

    // Check migration sourceId idempotency first
    if (cleanSourceId) {
      const existingBySource = await prisma.note.findFirst({
        where: { sourceId: cleanSourceId, userId },
        include: {
          section: { select: { id: true, name: true, color: true, icon: true } },
          book: { select: { id: true, title: true, author: true } },
        },
      });
      if (existingBySource) {
        return res.status(200).json({
          message: 'Note already exists for this migration source ID (idempotent create).',
          note: existingBySource,
          isExisting: true,
        });
      }
    }

    const trimmedTitle = typeof title === 'string' && title.trim().length > 0
      ? title.trim().slice(0, 255)
      : 'Untitled Note';

    const noteContent = typeof content === 'string' ? content : '';

    let linkedBookId = null;
    let bookTitleSnapshot = null;
    let notePage = null;
    let noteType = 'STANDALONE';

    // Verify section ownership if sectionId is provided
    let linkedSectionId = null;
    if (sectionId) {
      if (isValidUuid(sectionId)) {
        const section = await prisma.noteSection.findFirst({
          where: { id: sectionId, userId },
        });
        if (section) {
          linkedSectionId = section.id;
        }
      }
    }

    // Handle book association
    if (bookId) {
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

      linkedBookId = book.id;
      bookTitleSnapshot = book.title;
      noteType = 'BOOK';

      if (page !== undefined && page !== null) {
        const parsedPage = parseInt(page, 10);
        if (isNaN(parsedPage) || parsedPage < 1) {
          return res.status(400).json({
            error: {
              message: 'Page number must be an integer greater than or equal to 1.',
              code: 'INVALID_PAGE',
            },
          });
        }
        notePage = parsedPage;
      }
    } else if (type === 'BOOK') {
      return res.status(400).json({
        error: {
          message: 'bookId is required when note type is BOOK.',
          code: 'BOOK_ID_REQUIRED',
        },
      });
    }

    const noteCategory = typeof category === 'string' && category.trim().length > 0
      ? category.trim().slice(0, 100)
      : 'Reflection';

    let parsedJournalDate = null;
    if (journalDate) {
      const parsed = new Date(journalDate);
      if (!isNaN(parsed.getTime())) {
        parsedJournalDate = parsed;
      }
    }

    // Idempotency check: only if no sourceId provided (compatibility mode), fall back to content matching
    if (!cleanSourceId) {
      const existingNote = await prisma.note.findFirst({
        where: {
          userId,
          bookId: linkedBookId,
          sectionId: linkedSectionId,
          title: trimmedTitle,
          content: noteContent,
          page: notePage,
        },
        include: {
          section: { select: { id: true, name: true, color: true, icon: true } },
          book: { select: { id: true, title: true, author: true } },
        },
      });

      if (existingNote) {
        return res.status(200).json({
          message: 'Note already exists (idempotent create).',
          note: existingNote,
          isExisting: true,
        });
      }
    }

    const note = await prisma.note.create({
      data: {
        userId,
        bookId: linkedBookId,
        sectionId: linkedSectionId,
        bookTitleSnapshot,
        title: trimmedTitle,
        content: noteContent,
        richContent: richContent || null,
        page: notePage,
        type: noteType,
        category: noteCategory,
        isPinned: Boolean(isPinned),
        journalDate: parsedJournalDate,
        appearance: appearance ? String(appearance).slice(0, 50) : 'classic-paper',
        typography: typography || null,
        sourceId: cleanSourceId || null,
      },
      include: {
        section: { select: { id: true, name: true, color: true, icon: true } },
        book: { select: { id: true, title: true, author: true } },
      },
    });

    return res.status(201).json({
      message: 'Note created successfully.',
      note,
    });
  } catch (err) {
    if (err.code === 'P2002' && req.body?.sourceId) {
      const existing = await prisma.note.findFirst({
        where: { sourceId: String(req.body.sourceId).trim(), userId: req.userId },
      });
      if (existing) {
        return res.status(200).json({
          message: 'Note already exists for this migration source ID (idempotent create).',
          note: existing,
          isExisting: true,
        });
      }
    }
    next(err);
  }
}

/**
 * GET /api/notes
 * List user's notes with pagination, search, and category/book filters.
 */
export async function listNotes(req, res, next) {
  try {
    const userId = req.userId;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { userId };

    if (req.query.bookId) {
      if (!isValidUuid(req.query.bookId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid bookId filter format.',
            code: 'INVALID_ID_FORMAT',
          },
        });
      }
      where.bookId = req.query.bookId;
    }

    if (req.query.type) {
      const typeUpper = req.query.type.toUpperCase();
      if (VALID_NOTE_TYPES.includes(typeUpper)) {
        where.type = typeUpper;
      }
    }

    if (req.query.category && typeof req.query.category === 'string') {
      where.category = req.query.category.trim();
    }

    if (req.query.sectionId) {
      if (req.query.sectionId === 'none' || req.query.sectionId === 'unsectioned') {
        where.sectionId = null;
      } else if (req.query.sectionId !== 'all') {
        if (isValidUuid(req.query.sectionId)) {
          where.sectionId = req.query.sectionId;
        }
      }
    }

    if (req.query.isPinned !== undefined) {
      where.isPinned = req.query.isPinned === 'true';
    }

    if (req.query.date) {
      const targetDate = new Date(req.query.date);
      if (!isNaN(targetDate.getTime())) {
        const start = new Date(targetDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(targetDate);
        end.setHours(23, 59, 59, 999);
        where.OR = [
          { journalDate: { gte: start, lte: end } },
          { createdAt: { gte: start, lte: end } },
        ];
      }
    }

    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim().length > 0) {
      const search = req.query.search.trim();
      const searchCondition = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchCondition }];
        delete where.OR;
      } else {
        where.OR = searchCondition;
      }
    }

    // Determine ordering
    let orderBy = [{ isPinned: 'desc' }, { updatedAt: 'desc' }];
    if (req.query.sortBy === 'recently-created') {
      orderBy = [{ isPinned: 'desc' }, { createdAt: 'desc' }];
    } else if (req.query.sortBy === 'title') {
      orderBy = [{ isPinned: 'desc' }, { title: 'asc' }];
    } else if (req.query.sortBy === 'journal-date') {
      orderBy = [{ isPinned: 'desc' }, { journalDate: 'desc' }, { createdAt: 'desc' }];
    }

    const [totalCount, notes] = await Promise.all([
      prisma.note.count({ where }),
      prisma.note.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          book: {
            select: {
              id: true,
              title: true,
              author: true,
            },
          },
          section: {
            select: {
              id: true,
              name: true,
              color: true,
              icon: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      notes,
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
 * GET /api/notes/:noteId
 * Retrieve a single note owned by the user.
 */
export async function getNote(req, res, next) {
  try {
    const { noteId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(noteId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid note ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const note = await prisma.note.findFirst({
      where: { id: noteId, userId },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            author: true,
          },
        },
        section: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
          },
        },
      },
    });

    if (!note) {
      return res.status(404).json({
        error: {
          message: 'Note not found or access denied.',
          code: 'NOTE_NOT_FOUND',
        },
      });
    }

    return res.status(200).json({
      note,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/notes/:noteId
 * Update title, content, page, category, or book assignment of an owned note.
 */
export async function updateNote(req, res, next) {
  try {
    const { noteId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(noteId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid note ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.note.findFirst({
      where: { id: noteId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Note not found or access denied.',
          code: 'NOTE_NOT_FOUND',
        },
      });
    }

    const updateData = {};
    const {
      title,
      content,
      richContent,
      page,
      category,
      bookId,
      sectionId,
      isPinned,
      journalDate,
      appearance,
      typography,
    } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: {
            message: 'Note title cannot be empty.',
            code: 'INVALID_TITLE',
          },
        });
      }
      updateData.title = title.trim().slice(0, 255);
    }

    if (content !== undefined) {
      updateData.content = typeof content === 'string' ? content : '';
    }

    if (richContent !== undefined) {
      updateData.richContent = richContent || null;
    }

    if (isPinned !== undefined) {
      updateData.isPinned = Boolean(isPinned);
    }

    if (appearance !== undefined) {
      updateData.appearance = appearance ? String(appearance).slice(0, 50) : 'classic-paper';
    }

    if (typography !== undefined) {
      updateData.typography = typography || null;
    }

    if (journalDate !== undefined) {
      if (journalDate === null) {
        updateData.journalDate = null;
      } else {
        const parsed = new Date(journalDate);
        if (!isNaN(parsed.getTime())) {
          updateData.journalDate = parsed;
        }
      }
    }

    if (sectionId !== undefined) {
      if (sectionId === null) {
        updateData.sectionId = null;
      } else {
        if (!isValidUuid(sectionId)) {
          return res.status(400).json({
            error: {
              message: 'Invalid section ID format.',
              code: 'INVALID_ID_FORMAT',
            },
          });
        }
        const targetSection = await prisma.noteSection.findFirst({
          where: { id: sectionId, userId },
        });
        if (!targetSection) {
          return res.status(404).json({
            error: {
              message: 'Section not found or access denied.',
              code: 'SECTION_NOT_FOUND',
            },
          });
        }
        updateData.sectionId = targetSection.id;
      }
    }

    if (category !== undefined) {
      updateData.category = typeof category === 'string' && category.trim().length > 0
        ? category.trim().slice(0, 100)
        : 'Reflection';
    }

    if (page !== undefined) {
      if (page === null) {
        updateData.page = null;
      } else {
        const parsedPage = parseInt(page, 10);
        if (isNaN(parsedPage) || parsedPage < 1) {
          return res.status(400).json({
            error: {
              message: 'Page number must be an integer greater than or equal to 1.',
              code: 'INVALID_PAGE',
            },
          });
        }
        updateData.page = parsedPage;
      }
    }

    // Reassignment to a different book or conversion to standalone
    if (bookId !== undefined) {
      if (bookId === null) {
        updateData.bookId = null;
        updateData.type = 'STANDALONE';
      } else {
        if (!isValidUuid(bookId)) {
          return res.status(400).json({
            error: {
              message: 'Invalid book ID format.',
              code: 'INVALID_ID_FORMAT',
            },
          });
        }
        const targetBook = await prisma.book.findFirst({
          where: { id: bookId, userId },
        });
        if (!targetBook) {
          return res.status(404).json({
            error: {
              message: 'Target book not found or access denied.',
              code: 'BOOK_NOT_FOUND',
            },
          });
        }
        updateData.bookId = targetBook.id;
        updateData.bookTitleSnapshot = targetBook.title;
        updateData.type = 'BOOK';
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: {
          message: 'No valid fields provided for note update.',
          code: 'NO_FIELDS_TO_UPDATE',
        },
      });
    }

    const updated = await prisma.note.update({
      where: { id: noteId },
      data: updateData,
      include: {
        section: { select: { id: true, name: true, color: true, icon: true } },
        book: { select: { id: true, title: true, author: true } },
      },
    });

    return res.status(200).json({
      message: 'Note updated successfully.',
      note: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/notes/:noteId
 * Delete an owned note.
 */
export async function deleteNote(req, res, next) {
  try {
    const { noteId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(noteId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid note ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.note.findFirst({
      where: { id: noteId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Note not found or access denied.',
          code: 'NOTE_NOT_FOUND',
        },
      });
    }

    await prisma.note.delete({
      where: { id: noteId },
    });

    return res.status(200).json({
      message: 'Note deleted successfully.',
      id: noteId,
    });
  } catch (err) {
    next(err);
  }
}
