/**
 * DocumentSearch.jsx
 * Polished, literary in-document search panel for the Aks Reading Room.
 *
 * Implements Phase OCR-3C requirements:
 * - Server-backed multilingual OCR search (GET /api/books/:bookId/search)
 * - 3-Tier Mode filtering (All, Exact, Normalized, Fuzzy)
 * - Debounced typing (300ms) with in-flight request cancellation via AbortController
 * - Loading, empty, and error states with retry
 * - Real-time OCR indexing warning banner for unindexed pages
 * - Safe structured snippet rendering without innerHTML XSS risk
 * - Pagination / Load More behavior using API contract
 * - Guest mode & unsaved book explanation and isolation
 * - Preserves reading position and panel state during page navigation
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertCircle,
  FileText,
  Scan,
  RefreshCw,
  Sparkles,
  Info,
  CheckCircle2,
  Play,
} from 'lucide-react';
import { booksApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { searchDocument } from '../../services/pdfService';
import { parseSafeSnippetSegments, distinguishPageMatches } from '../../utils/searchCoordinates';

const SEARCH_MODES = [
  { id: 'all', label: 'All' },
  { id: 'exact', label: 'Exact' },
  { id: 'normalized', label: 'Normalized' },
  { id: 'fuzzy', label: 'Fuzzy' },
];

export default function DocumentSearch({
  pdfDoc,
  book,
  isSaved = false,
  isOpen,
  onClose,
  onJumpToPage,
  onSelectSearchMatch = null,
  activeSearchMatch = null,
  onSearchResultsChange = null,
}) {
  const { isAuthenticated, isGuest } = useAuth();

  const [query, setQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState('all');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Pagination state
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    totalMatches: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Indexing status from server
  const [ocrStatus, setOcrStatus] = useState(null);

  // Active highlighted match index
  const [activeResultIdx, setActiveResultIdx] = useState(0);

  // Client-side fallback progress (for guest/unsaved books)
  const [clientProgress, setClientProgress] = useState({ current: 0, total: 0 });

  // Indexing action state
  const [isTriggeringIndex, setIsTriggeringIndex] = useState(false);

  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const currentBookIdRef = useRef(book?.id);

  // Enrich results so multiple matches on the same page can be clearly distinguished
  const enrichedResults = useMemo(() => {
    return distinguishPageMatches(results);
  }, [results]);

  // Synchronize enriched results with parent
  useEffect(() => {
    if (onSearchResultsChange) {
      onSearchResultsChange(enrichedResults);
    }
  }, [enrichedResults, onSearchResultsChange]);

  // Determine if book can use server search
  const canUseServerSearch = Boolean(
    isAuthenticated && !isGuest && isSaved && book?.id
  );

  // Auto-focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Reset state when switching books or closing panel
  useEffect(() => {
    if (book?.id !== currentBookIdRef.current) {
      currentBookIdRef.current = book?.id;
      setQuery('');
      setResults([]);
      setSearched(false);
      setSearchError(null);
      setOcrStatus(null);
      setActiveResultIdx(0);
      if (onSelectSearchMatch) onSelectSearchMatch(null);
    }
  }, [book?.id, onSelectSearchMatch]);

  // Clean up in-flight requests and debounce on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /**
   * Execute search against backend API (or client-side fallback if guest)
   */
  const executeSearch = useCallback(
    async (searchQuery, mode = 'all', pageNum = 1, append = false) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setResults([]);
        setSearched(false);
        setSearchError(null);
        setOcrStatus(null);
        if (onSelectSearchMatch) onSelectSearchMatch(null);
        return;
      }

      if (trimmed.length > 200) {
        setSearchError('Search query must be 200 characters or fewer.');
        return;
      }

      // Abort prior in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setSearching(true);
        setSearched(false);
        setSearchError(null);
      }

      // ── Scenario A: Authenticated & Saved Book -> Backend Multilingual OCR Search
      if (canUseServerSearch) {
        try {
          const res = await booksApi.searchBook(
            book.id,
            { q: trimmed, mode, page: pageNum, limit: 20 },
            { signal: controller.signal }
          );

          if (!controller.signal.aborted) {
            const newResults = append ? [...results, ...(res.results || [])] : res.results || [];
            setResults(newResults);
            setPagination(res.pagination || {
              page: pageNum,
              limit: 20,
              totalMatches: newResults.length,
              totalPages: 1,
              hasNextPage: false,
              hasPrevPage: false,
            });
            setOcrStatus(res.ocrStatus || null);
            setSearched(true);
            setSearchError(null);

            if (!append && newResults.length > 0) {
              setActiveResultIdx(0);
              const first = newResults[0];
              onJumpToPage(first.pageNumber);
              if (onSelectSearchMatch) onSelectSearchMatch(first);
            }
          }
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) {
            return; // Normal cancellation
          }
          console.warn('[DocumentSearch] Server search error:', err);
          setSearchError(err.message || 'Unable to complete search. Please try again.');
        } finally {
          if (!controller.signal.aborted) {
            setSearching(false);
            setIsLoadingMore(false);
          }
        }
        return;
      }

      // ── Scenario B: Guest Mode or Unsaved Book -> Client-Side PDF.js Fallback
      if (!pdfDoc) {
        setResults([]);
        setSearched(true);
        setSearching(false);
        return;
      }

      try {
        const found = await searchDocument(pdfDoc, trimmed, (current, total) => {
          if (!controller.signal.aborted) {
            setClientProgress({ current, total });
          }
        });

        if (!controller.signal.aborted) {
          // Normalize client matches to match API schema shape
          const adaptedResults = found.map((f) => ({
            pageNumber: f.page,
            source: 'NATIVE',
            matchType: 'EXACT',
            score: 1.0,
            pageConfidence: 1.0,
            snippet: f.preview,
            highlightedSnippet: f.preview,
            matchedTerm: trimmed,
            bbox: null,
            normalizerVersion: 'client_pdfjs',
          }));

          setResults(adaptedResults);
          setPagination({
            page: 1,
            limit: adaptedResults.length,
            totalMatches: adaptedResults.length,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          });
          setOcrStatus(null);
          setSearched(true);
          setSearchError(null);

          if (adaptedResults.length > 0) {
            setActiveResultIdx(0);
            onJumpToPage(adaptedResults[0].pageNumber);
            if (onSelectSearchMatch) onSelectSearchMatch(adaptedResults[0]);
          }
        }
      } catch (err) {
        if (err.name === 'AbortError' || controller.signal.aborted) return;
        setSearchError('Client search failed. Please try again.');
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
          setIsLoadingMore(false);
        }
      }
    },
    [book?.id, canUseServerSearch, pdfDoc, results, onJumpToPage, onSelectSearchMatch]
  );

  // Fetch initial OCR status on panel open for authenticated books
  useEffect(() => {
    if (isOpen && canUseServerSearch && book?.id && !ocrStatus) {
      booksApi.getOcrStatus(book.id)
        .then((res) => {
          if (res) {
            setOcrStatus(res);
          }
        })
        .catch((e) => {
          console.warn('[DocumentSearch] Failed to fetch initial OCR status:', e);
        });
    }
  }, [isOpen, canUseServerSearch, book?.id, ocrStatus]);

  // Poll OCR status while an indexing job is active
  useEffect(() => {
    const isJobActive =
      ocrStatus?.activeJob ||
      ocrStatus?.latestJob?.status === 'PENDING' ||
      ocrStatus?.latestJob?.status === 'PROCESSING';

    if (isOpen && canUseServerSearch && book?.id && isJobActive) {
      pollingTimerRef.current = setTimeout(async () => {
        try {
          const res = await booksApi.getOcrStatus(book.id);
          if (res) {
            setOcrStatus(res);
            // If the job finished, refresh the search query if active
            const finished = res.latestJob?.status === 'COMPLETED' || res.latestJob?.status === 'FAILED';
            if (finished && query.trim().length > 0) {
              executeSearch(query, selectedMode, 1, false);
            }
          }
        } catch (e) {
          console.warn('[DocumentSearch] Error polling OCR status:', e);
        }
      }, 1500);
    }

    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
      }
    };
  }, [isOpen, canUseServerSearch, book?.id, ocrStatus, query, selectedMode, executeSearch]);

  const handleStartIndexing = async () => {
    if (!book?.id || isTriggeringIndex) return;
    setIsTriggeringIndex(true);
    setSearchError(null);
    try {
      await booksApi.requestOcr(book.id);
      const updated = await booksApi.getOcrStatus(book.id);
      setOcrStatus(updated);
    } catch (err) {
      console.error('[DocumentSearch] Failed to start indexing:', err);
      setSearchError(err.message || 'Failed to start indexing.');
    } finally {
      setIsTriggeringIndex(false);
    }
  };

  const handleRetryIndexing = async () => {
    if (!book?.id || isTriggeringIndex) return;
    setIsTriggeringIndex(true);
    setSearchError(null);
    try {
      await booksApi.retryOcr(book.id);
      const updated = await booksApi.getOcrStatus(book.id);
      setOcrStatus(updated);
    } catch (err) {
      console.error('[DocumentSearch] Failed to retry indexing:', err);
      setSearchError(err.message || 'Failed to retry indexing.');
    } finally {
      setIsTriggeringIndex(false);
    }
  };

  // Trigger debounced search when query changes
  const handleQueryChange = (val) => {
    setQuery(val);
    setSearchError(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!val.trim()) {
      setResults([]);
      setSearched(false);
      setOcrStatus(null);
      if (onSelectSearchMatch) onSelectSearchMatch(null);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(val, selectedMode, 1, false);
    }, 320);
  };

  // Mode tab change
  const handleModeChange = (mode) => {
    setSelectedMode(mode);
    if (query.trim()) {
      executeSearch(query, mode, 1, false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
    setSearchError(null);
    setOcrStatus(null);
    if (onSelectSearchMatch) onSelectSearchMatch(null);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      executeSearch(query, selectedMode, 1, false);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSelectResult = (r, idx) => {
    setActiveResultIdx(idx);
    onJumpToPage(r.pageNumber);
    if (onSelectSearchMatch) {
      onSelectSearchMatch(r);
    }
  };

  const navigateResult = (direction) => {
    if (enrichedResults.length === 0) return;
    const nextIdx = (activeResultIdx + direction + enrichedResults.length) % enrichedResults.length;
    setActiveResultIdx(nextIdx);
    const target = enrichedResults[nextIdx];
    onJumpToPage(target.pageNumber);
    if (onSelectSearchMatch) {
      onSelectSearchMatch(target);
    }
  };

  const handleLoadMore = () => {
    if (!pagination.hasNextPage || isLoadingMore || searching) return;
    executeSearch(query, selectedMode, pagination.page + 1, true);
  };

  if (!isOpen) return null;

  return (
    <div
      className="doc-search-panel"
      role="search"
      aria-label="Document search"
      data-testid="doc-search-panel"
    >
      {/* ── Search Input Row ────────────────────────────────────────────────── */}
      <div className="doc-search-input-row">
        <Search size={16} className="doc-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="doc-search-input"
          placeholder={
            canUseServerSearch
              ? 'Search text or Devanagari in volume…'
              : 'Search in document (Ctrl+F)…'
          }
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search query"
          autoComplete="off"
          spellCheck="false"
        />

        {query && (
          <button
            className="doc-search-action-btn"
            onClick={handleClear}
            aria-label="Clear search query"
            title="Clear"
          >
            <X size={14} />
          </button>
        )}

        <button
          className="doc-search-action-btn doc-search-action-btn--go"
          onClick={() => executeSearch(query, selectedMode, 1, false)}
          disabled={!query.trim() || searching}
          aria-label="Execute search"
          title="Search (Enter)"
        >
          {searching ? <Loader2 size={14} className="rdr-spin" /> : <Search size={14} />}
        </button>

        <button
          className="doc-search-close-btn"
          onClick={onClose}
          aria-label="Close search"
          title="Close search (Esc)"
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Mode Selector Tabs (Server-backed search only) ────────────────────── */}
      {canUseServerSearch && (
        <div className="doc-search-mode-tabs" role="tablist" aria-label="Search matching mode">
          {SEARCH_MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={selectedMode === m.id}
              className={`doc-search-mode-tab ${selectedMode === m.id ? 'doc-search-mode-tab--active' : ''}`}
              onClick={() => handleModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Guest / Unsaved Book Informational Notice ─────────────────────────── */}
      {!canUseServerSearch && (
        <div className="doc-search-notice doc-search-notice--guest" role="status">
          <Info size={14} className="text-gold flex-shrink-0" />
          <span>
            Server-backed OCR search is unavailable for unsaved or guest books. Showing client-side
            text layer matches only.
          </span>
        </div>
      )}

      {/* ── Active Indexing Job Progress Banner ─────────────────────────────── */}
      {ocrStatus && (ocrStatus.activeJob || ocrStatus.latestJob?.status === 'PENDING' || ocrStatus.latestJob?.status === 'PROCESSING') && (
        <div className="doc-search-notice doc-search-notice--indexing doc-search-notice--active" role="status">
          <div className="doc-search-notice-row">
            <Loader2 size={14} className="rdr-spin text-amber flex-shrink-0" />
            <div className="doc-search-notice-content">
              <span className="font-medium">Indexing in progress:</span>{' '}
              <span>{ocrStatus.activeJob?.progress || `${ocrStatus.indexedPages} / ${ocrStatus.totalPages}`} pages</span>
            </div>
          </div>
          <div className="doc-search-notice-sub">
            <span>{ocrStatus.nativePages} native</span>
            <span>•</span>
            <span>{ocrStatus.ocrPages} OCR</span>
            {ocrStatus.blankPages > 0 && (
              <>
                <span>•</span>
                <span>{ocrStatus.blankPages} blank</span>
              </>
            )}
            {ocrStatus.failedPages > 0 && (
              <>
                <span>•</span>
                <span className="text-red font-semibold">{ocrStatus.failedPages} failed</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Unindexed Warning Banner & Index Book / Retry Actions ──────────────── */}
      {ocrStatus && ocrStatus.unindexedPages > 0 && !(ocrStatus.activeJob || ocrStatus.latestJob?.status === 'PENDING' || ocrStatus.latestJob?.status === 'PROCESSING') && (
        <div className="doc-search-notice doc-search-notice--indexing" role="alert">
          <div className="doc-search-notice-row">
            <AlertCircle size={14} className="text-amber flex-shrink-0" />
            <span className="flex-1">{ocrStatus.warning}</span>
          </div>
          <div className="doc-search-actions-row">
            <button
              type="button"
              className="doc-search-index-btn"
              onClick={handleStartIndexing}
              disabled={isTriggeringIndex}
              title="Index unindexed pages for full-text search"
            >
              {isTriggeringIndex ? (
                <>
                  <Loader2 size={12} className="rdr-spin" /> Starting…
                </>
              ) : (
                <>
                  <Play size={12} /> Index Book
                </>
              )}
            </button>
            {ocrStatus.failedPages > 0 && (
              <button
                type="button"
                className="doc-search-index-btn doc-search-index-btn--secondary"
                onClick={handleRetryIndexing}
                disabled={isTriggeringIndex}
                title="Retry failed pages"
              >
                <RefreshCw size={12} /> Retry Failed ({ocrStatus.failedPages})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Status & Navigation Bar ───────────────────────────────────────────── */}
      <div className="doc-search-status" aria-live="polite" aria-atomic="true">
        {searching && (
          <span className="doc-search-progress">
            <Loader2 size={13} className="rdr-spin" />
            {canUseServerSearch
              ? 'Searching multilingual index…'
              : `Scanning page ${clientProgress.current} of ${clientProgress.total}…`}
          </span>
        )}

        {searchError && !searching && (
          <div className="doc-search-error">
            <AlertCircle size={13} />
            <span>{searchError}</span>
            <button
              className="doc-search-retry-btn"
              onClick={() => executeSearch(query, selectedMode, 1, false)}
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        {!searching && searched && enrichedResults.length === 0 && !searchError && (
          <span className="doc-search-no-results">
            {ocrStatus && ocrStatus.unindexedPages > 0
              ? `No matches found in currently indexed pages (${ocrStatus.indexedPages}/${ocrStatus.totalPages} indexed).`
              : `No matches found for "${query}".`}
          </span>
        )}

        {!searching && enrichedResults.length > 0 && (
          <div className="doc-search-results-bar">
            <span className="doc-search-count">
              {pagination.totalMatches} matching page{pagination.totalMatches !== 1 ? 's' : ''}
              {selectedMode !== 'all' && ` (${selectedMode})`}
            </span>
            <div className="doc-search-nav-btns">
              <button
                className="doc-search-nav-btn"
                onClick={() => navigateResult(-1)}
                disabled={enrichedResults.length <= 1}
                aria-label="Previous match"
                title="Previous match"
              >
                <ChevronUp size={14} />
              </button>
              <span className="doc-search-nav-idx">
                {activeResultIdx + 1} / {enrichedResults.length}
              </span>
              <button
                className="doc-search-nav-btn"
                onClick={() => navigateResult(1)}
                disabled={enrichedResults.length <= 1}
                aria-label="Next match"
                title="Next match"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Results List ──────────────────────────────────────────────────────── */}
      {enrichedResults.length > 0 && (
        <ul className="doc-search-results-list" aria-label="Search results">
          {enrichedResults.map((r, idx) => {
            const isSelected = idx === activeResultIdx;
            const segments = parseSafeSnippetSegments(r.highlightedSnippet, r.snippet);

            return (
              <li key={`${r.pageNumber}-${r._matchOnPage || idx}-${idx}`}>
                <button
                  className={`doc-search-result-item ${isSelected ? 'doc-search-result-item--active' : ''}`}
                  onClick={() => handleSelectResult(r, idx)}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <div className="doc-search-result-header">
                    <span className="doc-search-result-page">
                      <FileText size={12} />
                      Page {r.pageNumber}
                      {r._totalOnPage > 1 && (
                        <span className="doc-search-page-occurrence">
                          (Match {r._matchOnPage} of {r._totalOnPage})
                        </span>
                      )}
                      {r.lineIndex !== null && r.lineIndex !== undefined && (
                        <span className="doc-search-line-tag">
                          Line {r.lineIndex + 1}
                        </span>
                      )}
                    </span>

                    <div className="doc-search-badges">
                      {/* Bounding box availability badge */}
                      {!r.bbox && (
                        <span
                          className="doc-search-badge doc-search-badge--no-bbox"
                          title="Exact visual coordinates unavailable for this match"
                        >
                          No Box
                        </span>
                      )}

                      {/* Match Type Badge */}
                      {r.matchType && r.matchType !== 'EXACT' && (
                        <span
                          className={`doc-search-badge doc-search-badge--${r.matchType.toLowerCase()}`}
                          title={`Matched via ${r.matchType.toLowerCase()} algorithm`}
                        >
                          {r.matchType === 'NORMALIZED' ? (
                            <>
                              <Sparkles size={10} /> Normalized
                            </>
                          ) : (
                            'Fuzzy'
                          )}
                        </span>
                      )}

                      {/* Source Badge */}
                      {r.source === 'OCR' ? (
                        <span className="doc-search-badge doc-search-badge--ocr" title="Transcribed via OCR">
                          <Scan size={10} /> OCR
                        </span>
                      ) : (
                        <span className="doc-search-badge doc-search-badge--native" title="Native PDF digital text">
                          Native
                        </span>
                      )}

                      {/* Confidence or Score Badge where meaningful */}
                      {r.source === 'OCR' && r.pageConfidence && r.pageConfidence < 0.98 && (
                        <span className="doc-search-score" title="Recognition Confidence">
                          {Math.round(r.pageConfidence * 100)}%
                        </span>
                      )}
                      {r.matchType === 'FUZZY' && r.score && (
                        <span className="doc-search-score" title="Fuzzy similarity score">
                          {Math.round(r.score * 100)}% sim
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Safe Structured Snippet with Highlight */}
                  <p className="doc-search-result-preview">
                    {segments.map((seg, sIdx) =>
                      seg.type === 'mark' ? (
                        <mark key={sIdx} className="doc-search-highlight">
                          {seg.text}
                        </mark>
                      ) : (
                        <React.Fragment key={sIdx}>{seg.text}</React.Fragment>
                      )
                    )}
                  </p>
                </button>
              </li>
            );
          })}

          {/* ── Load More / Pagination Button ──────────────────────────────────── */}
          {pagination.hasNextPage && (
            <li className="doc-search-load-more-row">
              <button
                className="doc-search-load-more-btn"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 size={13} className="rdr-spin" /> Loading more…
                  </>
                ) : (
                  `Load more matches (${enrichedResults.length} of ${pagination.totalMatches})`
                )}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
