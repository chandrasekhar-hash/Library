/**
 * Multilingual Search Engine & Layered Matching Pipeline for Aks (अक्स)
 *
 * Implements Phase OCR-3B requirements:
 * - Tier 1: Exact matching (case-insensitive Latin, Unicode NFC Devanagari)
 * - Tier 2: Normalized matching via DevanagariSearchNormalizer v1.0.0 (preserves Nuktas by default)
 * - Tier 3: Bounded typo-tolerant fuzzy matching (Levenshtein + pg_trgm trigrams)
 * - Native and OCR page deduplication (single canonical record per page)
 * - Contextual snippet extraction with <mark> highlighting and bbox coordinates
 * - Transparent OCR indexing status (alerts user when book is partially unindexed)
 * - Multi-tenant isolation at database level
 */

import { prisma } from './prisma.js';
import { DevanagariSearchNormalizer } from '../utils/devanagariNormalizer.js';
import { FuzzyMatcher } from '../utils/fuzzyMatcher.js';

export class SearchEngine {
  /**
   * Search an owned book using the 3-tier matching pipeline.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.bookId
   * @param {string} params.query
   * @param {number} [params.page=1]
   * @param {number} [params.limit=20]
   * @param {string} [params.mode='all'] - 'all' | 'exact' | 'normalized' | 'fuzzy'
   * @returns {Promise<Object>} Search results with pagination and OCR status metadata
   */
  static async searchBook({ userId, bookId, query, page = 1, limit = 20, mode = 'all' }) {
    const startTime = Date.now();

    // 1. Validate inputs
    if (!userId || !bookId) {
      const err = new Error('userId and bookId are required for search.');
      err.statusCode = 400;
      err.code = 'INVALID_ARGUMENT';
      throw err;
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      const err = new Error('Query parameter "q" is required and cannot be empty.');
      err.statusCode = 400;
      err.code = 'QUERY_REQUIRED';
      throw err;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 200) {
      const err = new Error('Search query exceeds maximum permitted length of 200 characters.');
      err.statusCode = 400;
      err.code = 'QUERY_TOO_LONG';
      throw err;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    // 2. Validate book ownership (multi-tenant boundary)
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      select: {
        id: true,
        title: true,
        totalPages: true,
        userId: true,
      },
    });

    if (!book) {
      const err = new Error('Book not found or access denied.');
      err.statusCode = 404;
      err.code = 'BOOK_NOT_FOUND';
      throw err;
    }

    // 3. Query pre-processing
    const queryNfc = trimmedQuery.normalize('NFC');
    const queryTokens = DevanagariSearchNormalizer.toSearchTokens(queryNfc, { stripNuktas: false });
    const isMultiWord = queryNfc.includes(' ');

    // 4. Retrieve candidate pages from PostgreSQL
    // Uses parameterized query to utilize GIN index on searchTokens, GIN trigram on rawText, and substring matching
    const sqlLikeQuery = `%${queryNfc}%`;
    const allowFuzzy = mode === 'all' || mode === 'fuzzy';
    const canFuzzyMatch = allowFuzzy && queryNfc.length >= 4;

    let candidatePages = [];
    if (canFuzzyMatch) {
      // Query with Exact, Normalized token array, OR trigram word similarity
      candidatePages = await prisma.$queryRaw`
        SELECT
          id,
          "pageNumber",
          source,
          "rawText",
          "searchTokens",
          "normalizerVersion",
          language,
          confidence,
          "lineCount",
          "detectedRotation",
          "bboxData",
          metadata
        FROM "BookPageOcr"
        WHERE "bookId" = ${bookId}
          AND "userId" = ${userId}
          AND (
            "rawText" ILIKE ${sqlLikeQuery}
            OR "searchTokens" @> ${queryTokens}::text[]
            OR (length(${queryNfc}) >= 4 AND word_similarity(${queryNfc}, "rawText") >= 0.5)
          )
        ORDER BY "pageNumber" ASC;
      `;
    } else {
      // Exact or Normalized token array only
      candidatePages = await prisma.$queryRaw`
        SELECT
          id,
          "pageNumber",
          source,
          "rawText",
          "searchTokens",
          "normalizerVersion",
          language,
          confidence,
          "lineCount",
          "detectedRotation",
          "bboxData",
          metadata
        FROM "BookPageOcr"
        WHERE "bookId" = ${bookId}
          AND "userId" = ${userId}
          AND (
            "rawText" ILIKE ${sqlLikeQuery}
            OR "searchTokens" @> ${queryTokens}::text[]
          )
        ORDER BY "pageNumber" ASC;
      `;
    }

    // 5. Apply 3-Tier Layered Matching on Candidate Pages
    const allMatches = [];

    for (const pageRecord of candidatePages) {
      const rawText = pageRecord.rawText || '';
      const rawTextNfc = rawText.normalize('NFC');
      const pageTokens = pageRecord.searchTokens || [];

      let matchType = null;
      let score = 0.0;
      let matchedTextSegment = null;
      let matchCharIndex = -1;

      // ── TIER 1: EXACT MATCH ───────────────────────────────────────────────
      // Case-insensitive substring match in raw transcript
      const exactIndex = rawTextNfc.toLowerCase().indexOf(queryNfc.toLowerCase());
      if (exactIndex !== -1 && (mode === 'all' || mode === 'exact')) {
        matchType = 'EXACT';
        score = 1.0;
        matchCharIndex = exactIndex;
        matchedTextSegment = rawTextNfc.slice(exactIndex, exactIndex + queryNfc.length);
      }

      // ── TIER 2: NORMALIZED MATCH ──────────────────────────────────────────
      // Checks if all normalized query tokens are present in page tokens
      if (!matchType && queryTokens.length > 0 && (mode === 'all' || mode === 'normalized')) {
        const pageTokenSet = new Set(pageTokens);
        const allTokensFound = queryTokens.every((tok) => pageTokenSet.has(tok));

        if (allTokensFound) {
          matchType = 'NORMALIZED';
          score = 0.85;

          // Find approximate position in rawText by locating the first matching token or token variant
          const primaryToken = queryTokens[0];
          const tokenRegex = new RegExp(`\\b${primaryToken}\\b`, 'iu');
          const tokenMatch = rawTextNfc.match(tokenRegex);
          if (tokenMatch && tokenMatch.index !== undefined) {
            matchCharIndex = tokenMatch.index;
            matchedTextSegment = tokenMatch[0];
          } else {
            // Find any word in rawText whose normalized form matches the primaryToken
            const words = rawTextNfc.split(/(\s+)/);
            let currentOffset = 0;
            for (const word of words) {
              const normWordTokens = DevanagariSearchNormalizer.toSearchTokens(word, { stripNuktas: false });
              if (normWordTokens.includes(primaryToken)) {
                matchCharIndex = currentOffset;
                matchedTextSegment = word;
                break;
              }
              currentOffset += word.length;
            }
          }
        }
      }

      // ── TIER 3: FUZZY MATCH ───────────────────────────────────────────────
      // Typo and OCR substitution tolerance with strict guardrails
      if (!matchType && canFuzzyMatch && (mode === 'all' || mode === 'fuzzy')) {
        const pageWords = rawTextNfc.split(/[\s\.,;:!\?"'\(\)\[\]\{\}—–\-।॥\/]+/).filter((w) => w.length > 0);

        if (isMultiWord && queryTokens.length > 1) {
          // Multi-word fuzzy matching: every query token must match a page word
          const matchedSegments = [];
          let allTokensMatched = true;
          let minTokenSim = 1.0;
          let hasFuzzyToken = false;

          for (const qTok of queryTokens) {
            if (qTok.length < 2) continue;
            let bestTokMatch = null;

            for (const pWord of pageWords) {
              if (pWord.toLowerCase() === qTok.toLowerCase()) {
                bestTokMatch = { word: pWord, similarity: 1.0, isFuzzy: false };
                break;
              }
              const m = FuzzyMatcher.matchWord(qTok, pWord);
              if (m.isMatch) {
                if (!bestTokMatch || m.similarity > bestTokMatch.similarity) {
                  bestTokMatch = { word: pWord, similarity: m.similarity, isFuzzy: true };
                }
              }
            }

            if (bestTokMatch) {
              matchedSegments.push(bestTokMatch.word);
              minTokenSim = Math.min(minTokenSim, bestTokMatch.similarity);
              if (bestTokMatch.isFuzzy) hasFuzzyToken = true;
            } else {
              allTokensMatched = false;
              break;
            }
          }

          if (allTokensMatched && hasFuzzyToken && matchedSegments.length > 0) {
            matchType = 'FUZZY';
            score = Math.round(minTokenSim * 0.75 * 100) / 100;
            matchCharIndex = rawTextNfc.indexOf(matchedSegments[0]);
            matchedTextSegment = matchedSegments[0];
          }
        } else {
          // Single-word fuzzy matching
          let bestFuzzyMatch = null;

          for (const word of pageWords) {
            if (!word || word.length < 3) continue;
            const matchResult = FuzzyMatcher.matchWord(queryNfc, word);
            if (matchResult.isMatch) {
              if (!bestFuzzyMatch || matchResult.similarity > bestFuzzyMatch.similarity) {
                bestFuzzyMatch = {
                  word,
                  distance: matchResult.distance,
                  similarity: matchResult.similarity,
                };
              }
            }
          }

          if (bestFuzzyMatch) {
            matchType = 'FUZZY';
            score = Math.round(bestFuzzyMatch.similarity * 0.80 * 100) / 100;
            matchCharIndex = rawTextNfc.indexOf(bestFuzzyMatch.word);
            matchedTextSegment = bestFuzzyMatch.word;
          }
        }
      }

      // If matched by one of the tiers, generate snippet and bounding box metadata
      if (matchType) {
        // Find matching lines from bboxData if available
        const matchingLines = Array.isArray(pageRecord.bboxData)
          ? pageRecord.bboxData.filter((l) => l?.text && l.text.toLowerCase().includes((matchedTextSegment || queryNfc).toLowerCase()))
          : [];

        if (matchingLines.length > 1) {
          for (let li = 0; li < matchingLines.length; li++) {
            const mLine = matchingLines[li];
            const lineIndex = pageRecord.bboxData.indexOf(mLine);
            const lineSnippet = this.extractSnippet(
              mLine.text,
              mLine.text.toLowerCase().indexOf((matchedTextSegment || queryNfc).toLowerCase()),
              matchedTextSegment || queryNfc
            );
            allMatches.push({
              pageNumber: pageRecord.pageNumber,
              source: pageRecord.source,
              matchType,
              score,
              pageConfidence: pageRecord.confidence,
              snippet: lineSnippet.snippet,
              highlightedSnippet: lineSnippet.highlightedSnippet,
              matchedTerm: matchedTextSegment || queryNfc,
              matchCharIndex: lineSnippet.matchCharIndex,
              lineIndex: lineIndex >= 0 ? lineIndex : li,
              bbox: mLine.bbox || null,
              detectedRotation: pageRecord.detectedRotation || 0,
              normalizerVersion: pageRecord.normalizerVersion || '1.0.0',
            });
          }
        } else {
          const snippetData = this.extractSnippet(rawTextNfc, matchCharIndex, matchedTextSegment || queryNfc);
          const bboxInfo = matchingLines[0]
            ? { lineIndex: pageRecord.bboxData.indexOf(matchingLines[0]), bbox: matchingLines[0].bbox }
            : this.findMatchingBbox(pageRecord.bboxData, matchedTextSegment || queryNfc);

          allMatches.push({
            pageNumber: pageRecord.pageNumber,
            source: pageRecord.source,
            matchType,
            score,
            pageConfidence: pageRecord.confidence,
            snippet: snippetData.snippet,
            highlightedSnippet: snippetData.highlightedSnippet,
            matchedTerm: matchedTextSegment || queryNfc,
            matchCharIndex: snippetData.matchCharIndex,
            lineIndex: bboxInfo?.lineIndex ?? null,
            bbox: bboxInfo?.bbox ?? null,
            detectedRotation: pageRecord.detectedRotation || 0,
            normalizerVersion: pageRecord.normalizerVersion || '1.0.0',
          });
        }
      }
    }

    // 6. Sort Matches
    // Priority: EXACT (1) > NORMALIZED (2) > FUZZY (3), then by score desc, then by pageNumber asc
    const tierPriority = { EXACT: 1, NORMALIZED: 2, FUZZY: 3 };
    allMatches.sort((a, b) => {
      const tierDiff = (tierPriority[a.matchType] || 99) - (tierPriority[b.matchType] || 99);
      if (tierDiff !== 0) return tierDiff;
      if (b.score !== a.score) return b.score - a.score;
      return a.pageNumber - b.pageNumber;
    });

    // 7. Paginate results
    const totalMatches = allMatches.length;
    const totalPages = Math.ceil(totalMatches / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedResults = allMatches.slice(startIndex, startIndex + limitNum);

    // 8. Retrieve OCR indexing status overview for this book
    const ocrStatus = await this.getBookOcrStatusSummary(bookId, userId, book.totalPages);

    const durationMs = Date.now() - startTime;

    return {
      query: trimmedQuery,
      bookId,
      bookTitle: book.title,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalMatches,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      ocrStatus,
      durationMs,
      results: paginatedResults,
    };
  }

  /**
   * Extract a context window snippet around the matched term with <mark> highlighting.
   */
  static extractSnippet(rawText, matchIndex, matchedTerm, windowSize = 50) {
    if (!rawText) {
      return { snippet: '', highlightedSnippet: '', matchCharIndex: 0 };
    }

    const safeIndex = matchIndex >= 0 ? matchIndex : 0;
    const termLength = matchedTerm ? matchedTerm.length : 0;

    let start = Math.max(0, safeIndex - windowSize);
    let end = Math.min(rawText.length, safeIndex + termLength + windowSize);

    // Snap to word boundaries if possible
    if (start > 0) {
      const spaceIdx = rawText.indexOf(' ', start);
      if (spaceIdx !== -1 && spaceIdx < safeIndex) {
        start = spaceIdx + 1;
      }
    }

    if (end < rawText.length) {
      const spaceIdx = rawText.lastIndexOf(' ', end);
      if (spaceIdx !== -1 && spaceIdx > safeIndex + termLength) {
        end = spaceIdx;
      }
    }

    const prefixEllipsis = start > 0 ? '… ' : '';
    const suffixEllipsis = end < rawText.length ? ' …' : '';

    const beforeMatch = rawText.slice(start, safeIndex);
    const matchSegment = rawText.slice(safeIndex, safeIndex + termLength);
    const afterMatch = rawText.slice(safeIndex + termLength, end);

    const plainSnippet = `${prefixEllipsis}${beforeMatch}${matchSegment}${afterMatch}${suffixEllipsis}`.replace(/\s+/g, ' ').trim();
    const highlightedSnippet = `${prefixEllipsis}${this.escapeHtml(beforeMatch)}<mark>${this.escapeHtml(matchSegment || matchedTerm)}</mark>${this.escapeHtml(afterMatch)}${suffixEllipsis}`.replace(/\s+/g, ' ').trim();

    return {
      snippet: plainSnippet,
      highlightedSnippet,
      matchCharIndex: safeIndex,
    };
  }

  /**
   * Find matching line and bounding box coordinates from page bboxData.
   */
  static findMatchingBbox(bboxData, term) {
    if (!Array.isArray(bboxData) || bboxData.length === 0 || !term) {
      return null;
    }

    const termLower = term.toLowerCase();

    for (let i = 0; i < bboxData.length; i++) {
      const line = bboxData[i];
      if (line?.text && line.text.toLowerCase().includes(termLower)) {
        return {
          lineIndex: i,
          bbox: line.bbox || null,
          lineText: line.text,
        };
      }
    }

    // Fallback: check if any line has words matching the term
    for (let i = 0; i < bboxData.length; i++) {
      const line = bboxData[i];
      if (line?.text) {
        const normLine = DevanagariSearchNormalizer.toSearchTokens(line.text);
        const normTerm = DevanagariSearchNormalizer.toSearchTokens(term);
        if (normTerm.length > 0 && normLine.includes(normTerm[0])) {
          return {
            lineIndex: i,
            bbox: line.bbox || null,
            lineText: line.text,
          };
        }
      }
    }

    return null;
  }

  /**
   * Escape HTML entities to prevent XSS in highlighted snippets.
   */
  static escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Compile OCR indexing coverage and active job state for transparent reporting.
   */
  static async getBookOcrStatusSummary(bookId, userId, bookTotalPages) {
    const totalPages = bookTotalPages || 0;

    const indexedPages = await prisma.bookPageOcr.count({
      where: { bookId, userId },
    });

    const nativePages = await prisma.bookPageOcr.count({
      where: { bookId, userId, source: 'NATIVE', lineCount: { gt: 0 } },
    });

    const ocrPages = await prisma.bookPageOcr.count({
      where: { bookId, userId, source: 'OCR', lineCount: { gt: 0 } },
    });

    const blankPages = await prisma.bookPageOcr.count({
      where: {
        bookId,
        userId,
        lineCount: 0,
        rawText: '',
      },
    });

    const latestJob = await prisma.ocrJob.findFirst({
      where: { bookId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        processedPages: true,
        totalPages: true,
        failedPages: true,
      },
    });

    const isFullyIndexed = totalPages > 0 ? indexedPages >= totalPages : indexedPages > 0;
    const unindexedPages = Math.max(0, totalPages - indexedPages);
    const failedPages = latestJob?.failedPages || 0;
    const canRetry = failedPages > 0 || (unindexedPages > 0 && (!latestJob || latestJob.status === 'COMPLETED' || latestJob.status === 'FAILED'));

    return {
      totalPages,
      indexedPages,
      nativePages,
      ocrPages,
      blankPages,
      failedPages,
      unindexedPages,
      isFullyIndexed,
      canRetry,
      activeJob: (latestJob && (latestJob.status === 'PENDING' || latestJob.status === 'PROCESSING'))
        ? {
            id: latestJob.id,
            status: latestJob.status,
            progress: `${latestJob.processedPages}/${latestJob.totalPages || totalPages}`,
            processedPages: latestJob.processedPages,
            totalPages: latestJob.totalPages || totalPages,
            failedPages: latestJob.failedPages,
          }
        : null,
      warning: unindexedPages > 0
        ? `This volume has ${unindexedPages} unindexed page(s). Results may be partial until OCR processing completes.`
        : null,
    };
  }
}
