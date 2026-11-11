/**
 * Search Controller for Aks (अक्स) Multilingual Book Search
 *
 * Exposes:
 * - GET /api/books/:bookId/search?q=<query>&page=1&limit=20&mode=all
 */

import { SearchEngine } from '../services/searchEngine.js';

/**
 * GET /api/books/:bookId/search
 * Search within an owned book across native and OCR-extracted text.
 */
export async function searchBook(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.resourceUserId || req.userId;
    const { q: query, page, limit, mode } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        error: {
          message: 'Search query parameter "q" is required and cannot be empty.',
          code: 'QUERY_REQUIRED',
        },
      });
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 200) {
      return res.status(400).json({
        error: {
          message: 'Search query exceeds maximum permitted length of 200 characters.',
          code: 'QUERY_TOO_LONG',
        },
      });
    }

    const searchResponse = await SearchEngine.searchBook({
      userId,
      bookId,
      query: trimmedQuery,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      mode: mode || 'all',
    });

    return res.status(200).json(searchResponse);
  } catch (err) {
    next(err);
  }
}

