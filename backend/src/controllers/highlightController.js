import { prisma } from '../services/prisma.js';
import { isValidUuid, SUPPORTED_ANNOTATION_COLORS } from '../utils/validators.js';

/**
 * Controller for Book Highlights in Aks (अक्स)
 *
 * Enforces:
 * - Ownership of both the user and the book
 * - Page number validation
 * - Text length validation
 * - Color validation and positionJson preservation
 * - Prevention of reassignment to another user's book
 */

/**
 * POST /api/books/:bookId/highlights
 * Create a highlight on an owned book.
 */
export async function createHighlight(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;
    const { page, text, color, positionJson, sourceId } = req.body;

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
      const existingBySource = await prisma.highlight.findFirst({
        where: { sourceId: cleanSourceId, userId },
      });
      if (existingBySource) {
        return res.status(200).json({
          message: 'Highlight already exists for this migration source ID (idempotent create).',
          highlight: existingBySource,
          isExisting: true,
        });
      }
    }

    // 2. Validate page
    const parsedPage = parseInt(page, 10);
    if (isNaN(parsedPage) || parsedPage < 1) {
      return res.status(400).json({
        error: {
          message: 'Page number must be an integer greater than or equal to 1.',
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

    // 3. Validate text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        error: {
          message: 'Highlighted text cannot be empty.',
          code: 'TEXT_REQUIRED',
        },
      });
    }

    if (text.length > 50000) {
      return res.status(400).json({
        error: {
          message: 'Highlighted text exceeds maximum allowed length of 50,000 characters.',
          code: 'TEXT_TOO_LONG',
        },
      });
    }

    // 4. Validate color
    let highlightColor = 'gold';
    if (color !== undefined) {
      if (typeof color !== 'string' || !SUPPORTED_ANNOTATION_COLORS.includes(color.trim().toLowerCase())) {
        return res.status(400).json({
          error: {
            message: `Invalid highlight color. Allowed colors: ${SUPPORTED_ANNOTATION_COLORS.join(', ')}`,
            code: 'INVALID_COLOR',
          },
        });
      }
      highlightColor = color.trim().toLowerCase();
    }

    // 5. Validate positionJson if provided
    let positionData = null;
    if (positionJson !== undefined && positionJson !== null) {
      if (typeof positionJson !== 'object') {
        return res.status(400).json({
          error: {
            message: 'positionJson must be a valid JSON object or null.',
            code: 'INVALID_POSITION_JSON',
          },
        });
      }
      positionData = positionJson;
    }

    // Idempotency check: if no sourceId provided (compatibility mode), fall back to content matching
    if (!cleanSourceId) {
      const existingHighlight = await prisma.highlight.findFirst({
        where: {
          bookId,
          userId,
          page: parsedPage,
          text: text.trim(),
          color: highlightColor,
        },
      });

      if (existingHighlight) {
        return res.status(200).json({
          message: 'Highlight already exists (idempotent create).',
          highlight: existingHighlight,
          isExisting: true,
        });
      }
    }

    const highlight = await prisma.highlight.create({
      data: {
        bookId,
        userId,
        page: parsedPage,
        text: text.trim(),
        color: highlightColor,
        positionJson: positionData,
        sourceId: cleanSourceId || null,
      },
    });

    return res.status(201).json({
      message: 'Highlight created successfully.',
      highlight,
    });
  } catch (err) {
    if (err.code === 'P2002' && req.body?.sourceId) {
      const existing = await prisma.highlight.findFirst({
        where: { sourceId: String(req.body.sourceId).trim(), userId: req.userId },
      });
      if (existing) {
        return res.status(200).json({
          message: 'Highlight already exists for this migration source ID (idempotent create).',
          highlight: existing,
          isExisting: true,
        });
      }
    }
    next(err);
  }
}

/**
 * GET /api/books/:bookId/highlights
 * List all highlights for an owned book.
 */
export async function listHighlights(req, res, next) {
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

    const highlights = await prisma.highlight.findMany({
      where: {
        bookId,
        userId,
      },
      orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
    });

    return res.status(200).json({
      highlights,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/highlights/:highlightId
 * Update color, text, or coordinates of an owned highlight.
 */
export async function updateHighlight(req, res, next) {
  try {
    const { highlightId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(highlightId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid highlight ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.highlight.findFirst({
      where: { id: highlightId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Highlight not found or access denied.',
          code: 'HIGHLIGHT_NOT_FOUND',
        },
      });
    }

    const updateData = {};
    const { color, text, positionJson } = req.body;

    if (color !== undefined) {
      if (typeof color !== 'string' || !SUPPORTED_ANNOTATION_COLORS.includes(color.trim().toLowerCase())) {
        return res.status(400).json({
          error: {
            message: `Invalid highlight color. Allowed colors: ${SUPPORTED_ANNOTATION_COLORS.join(', ')}`,
            code: 'INVALID_COLOR',
          },
        });
      }
      updateData.color = color.trim().toLowerCase();
    }

    if (text !== undefined) {
      if (typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({
          error: {
            message: 'Highlight text cannot be empty.',
            code: 'TEXT_REQUIRED',
          },
        });
      }
      if (text.length > 50000) {
        return res.status(400).json({
          error: {
            message: 'Highlight text exceeds maximum allowed length of 50,000 characters.',
            code: 'TEXT_TOO_LONG',
          },
        });
      }
      updateData.text = text.trim();
    }

    if (positionJson !== undefined) {
      if (positionJson !== null && typeof positionJson !== 'object') {
        return res.status(400).json({
          error: {
            message: 'positionJson must be an object or null.',
            code: 'INVALID_POSITION_JSON',
          },
        });
      }
      updateData.positionJson = positionJson;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: {
          message: 'No valid fields provided for highlight update.',
          code: 'NO_FIELDS_TO_UPDATE',
        },
      });
    }

    const updated = await prisma.highlight.update({
      where: { id: highlightId },
      data: updateData,
    });

    return res.status(200).json({
      message: 'Highlight updated successfully.',
      highlight: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/highlights/:highlightId
 * Delete an owned highlight.
 */
export async function deleteHighlight(req, res, next) {
  try {
    const { highlightId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(highlightId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid highlight ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const existing = await prisma.highlight.findFirst({
      where: { id: highlightId, userId },
    });

    if (!existing) {
      return res.status(404).json({
        error: {
          message: 'Highlight not found or access denied.',
          code: 'HIGHLIGHT_NOT_FOUND',
        },
      });
    }

    await prisma.highlight.delete({
      where: { id: highlightId },
    });

    return res.status(200).json({
      message: 'Highlight deleted successfully.',
      id: highlightId,
    });
  } catch (err) {
    next(err);
  }
}
