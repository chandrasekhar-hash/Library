import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Search,
  BookOpen,
  Layers,
  ChevronRight,
  Info,
  Loader2,
} from 'lucide-react';
import { libraryIndexingApi, booksApi } from '../../services/api';

export default function LibraryIndexingDrawer({ isOpen, onClose }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'unindexed' | 'completed' | 'failed'
  const [searchQuery, setSearchQuery] = useState('');

  const pollTimerRef = useRef(null);

  // Fetch status from API
  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const data = await libraryIndexingApi.getStatus();
      setStatusData(data);
      setError(null);
    } catch (err) {
      console.error('[LibraryIndexingDrawer] Failed to fetch status:', err);
      if (!isSilent) {
        setError(err.message || 'Failed to fetch library indexing status.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load and polling setup
  useEffect(() => {
    if (!isOpen) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    fetchStatus(false);

    // Poll every 3.5s if queue is active
    pollTimerRef.current = setInterval(() => {
      fetchStatus(true);
    }, 3500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen, fetchStatus]);

  // Action handlers
  const handleStartAll = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await libraryIndexingApi.start();
      await fetchStatus(true);
    } catch (err) {
      setError(err.message || 'Failed to start library indexing.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await libraryIndexingApi.pause();
      await fetchStatus(true);
    } catch (err) {
      setError(err.message || 'Failed to pause queue.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await libraryIndexingApi.resume();
      await fetchStatus(true);
    } catch (err) {
      setError(err.message || 'Failed to resume queue.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryFailed = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await libraryIndexingApi.retryFailed();
      await fetchStatus(true);
    } catch (err) {
      setError(err.message || 'Failed to retry indexing.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIndexBook = async (bookId) => {
    setActionLoading(true);
    setError(null);
    try {
      await booksApi.requestOcr(bookId);
      await fetchStatus(true);
    } catch (err) {
      setError(err.message || 'Failed to request indexing for book.');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  const summary = statusData?.summary || {
    totalBooks: 0,
    eligibleBooks: 0,
    fullyIndexedBooks: 0,
    inProgressBooks: 0,
    partiallyIndexedBooks: 0,
    unindexedBooks: 0,
    failedBooks: 0,
    totalPages: 0,
    indexedPages: 0,
    nativePages: 0,
    ocrPages: 0,
    blankPages: 0,
    unindexedPages: 0,
    overallPercent: 0,
    isPaused: false,
    pendingJobCount: 0,
  };

  const books = statusData?.books || [];

  // Filter books list
  const filteredBooks = books.filter((b) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesTitle = b.title?.toLowerCase().includes(q);
      const matchesAuthor = b.author?.toLowerCase().includes(q);
      if (!matchesTitle && !matchesAuthor) return false;
    }
    if (filterMode === 'unindexed') return !b.isFullyIndexed && b.physicalPdfExists;
    if (filterMode === 'completed') return b.isFullyIndexed;
    if (filterMode === 'failed') return b.status === 'FAILED' || b.failedPages > 0;
    return true;
  });

  const isQueueRunning = summary.inProgressBooks > 0 || summary.pendingJobCount > 0;

  return (
    <div className="lib-idx-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lib-idx-drawer" onClick={(e) => e.stopPropagation()}>
        {/* ── Drawer Header ────────────────────────────────────────────── */}
        <header className="lib-idx-header">
          <div className="lib-idx-header-title">
            <div className="lib-idx-badge">
              <Sparkles size={13} className="text-gold" />
              <span>Full-Text Search Engine</span>
            </div>
            <h2>Library Search Index</h2>
            <p>
              Unified indexing for multilingual search across digital and scanned PDF volumes.
            </p>
          </div>
          <div className="lib-idx-header-actions">
            <button
              type="button"
              className="lib-idx-icon-btn"
              onClick={() => fetchStatus(false)}
              disabled={refreshing}
              title="Refresh status"
            >
              <RefreshCw size={16} className={refreshing ? 'rdr-spin' : ''} />
            </button>
            <button
              type="button"
              className="lib-idx-close-btn"
              onClick={onClose}
              title="Close drawer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* ── Error Banner ────────────────────────────────────────────── */}
        {error && (
          <div className="lib-idx-error-banner" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Overview Statistics Cards ─────────────────────────────────── */}
        <div className="lib-idx-stats-grid">
          {/* Card 1: Overall Progress */}
          <div className="lib-idx-stat-card lib-idx-stat-card--accent">
            <div className="lib-idx-stat-label">Indexed Coverage</div>
            <div className="lib-idx-stat-value">
              {summary.overallPercent}%
              <span className="lib-idx-stat-sub">
                {summary.indexedPages} / {summary.totalPages} pages
              </span>
            </div>
            <div className="lib-idx-progress-track">
              <div
                className="lib-idx-progress-fill lib-idx-progress-fill--gold"
                style={{ width: `${summary.overallPercent}%` }}
              />
            </div>
            <div className="lib-idx-stat-breakdown">
              <span>{summary.fullyIndexedBooks} of {summary.eligibleBooks} volumes indexed</span>
            </div>
          </div>

          {/* Card 2: Text Breakdown */}
          <div className="lib-idx-stat-card">
            <div className="lib-idx-stat-label">Extraction Breakdown</div>
            <div className="lib-idx-pill-stack">
              <div className="lib-idx-pill lib-idx-pill--native">
                <span className="lib-idx-pill-dot" />
                <span>Native Text:</span>
                <strong>{summary.nativePages}</strong>
              </div>
              <div className="lib-idx-pill lib-idx-pill--ocr">
                <span className="lib-idx-pill-dot" />
                <span>OCR Scanned:</span>
                <strong>{summary.ocrPages}</strong>
              </div>
              <div className="lib-idx-pill lib-idx-pill--blank">
                <span className="lib-idx-pill-dot" />
                <span>Blank Pages:</span>
                <strong>{summary.blankPages}</strong>
              </div>
            </div>
          </div>

          {/* Card 3: Queue & Work Status */}
          <div className="lib-idx-stat-card">
            <div className="lib-idx-stat-label">Queue & Engine</div>
            <div className="lib-idx-queue-status">
              {summary.isPaused ? (
                <span className="lib-idx-status-tag lib-idx-status-tag--paused">
                  <Pause size={12} /> Queue Paused
                </span>
              ) : isQueueRunning ? (
                <span className="lib-idx-status-tag lib-idx-status-tag--active">
                  <Loader2 size={12} className="rdr-spin" /> Processing Books
                </span>
              ) : (
                <span className="lib-idx-status-tag lib-idx-status-tag--idle">
                  <CheckCircle2 size={12} /> Idle & Ready
                </span>
              )}
            </div>
            <div className="lib-idx-stat-breakdown">
              <span>{summary.inProgressBooks} running • {summary.pendingJobCount} queued • {summary.unindexedPages} pages left</span>
            </div>
          </div>
        </div>

        {/* ── Global Action Controls Bar ───────────────────────────────── */}
        <div className="lib-idx-actions-bar">
          <div className="lib-idx-actions-left">
            <button
              type="button"
              className="lib-idx-primary-btn"
              onClick={handleStartAll}
              disabled={actionLoading || summary.unindexedPages === 0 || isQueueRunning}
              title="Queue all eligible unindexed volumes"
            >
              <Play size={14} />
              <span>Index All Books</span>
            </button>

            {summary.isPaused ? (
              <button
                type="button"
                className="lib-idx-secondary-btn"
                onClick={handleResume}
                disabled={actionLoading}
                title="Resume queue execution"
              >
                <Play size={14} />
                <span>Resume Queue</span>
              </button>
            ) : (
              <button
                type="button"
                className="lib-idx-secondary-btn"
                onClick={handlePause}
                disabled={actionLoading || !isQueueRunning}
                title="Pause queue after current page"
              >
                <Pause size={14} />
                <span>Pause Queue</span>
              </button>
            )}

            {(summary.failedBooks > 0 || summary.failedPages > 0) && (
              <button
                type="button"
                className="lib-idx-secondary-btn lib-idx-secondary-btn--danger"
                onClick={handleRetryFailed}
                disabled={actionLoading}
                title="Retry failed volumes"
              >
                <RotateCcw size={14} />
                <span>Retry Failed</span>
              </button>
            )}
          </div>

          {/* Search & Filter within Drawer */}
          <div className="lib-idx-actions-right">
            <div className="lib-idx-search-box">
              <Search size={14} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search volume title..."
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="lib-idx-filter-tabs">
              <button
                type="button"
                className={filterMode === 'all' ? 'active' : ''}
                onClick={() => setFilterMode('all')}
              >
                All ({books.length})
              </button>
              <button
                type="button"
                className={filterMode === 'unindexed' ? 'active' : ''}
                onClick={() => setFilterMode('unindexed')}
              >
                Needs Indexing ({summary.unindexedBooks + summary.partiallyIndexedBooks})
              </button>
              <button
                type="button"
                className={filterMode === 'completed' ? 'active' : ''}
                onClick={() => setFilterMode('completed')}
              >
                Complete ({summary.fullyIndexedBooks})
              </button>
            </div>
          </div>
        </div>

        {/* ── Book Indexing List Table ─────────────────────────────────── */}
        <div className="lib-idx-list-container">
          {loading ? (
            <div className="lib-idx-loading">
              <Loader2 size={24} className="rdr-spin text-gold" />
              <span>Analyzing library coverage...</span>
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="lib-idx-empty">
              <BookOpen size={28} className="text-muted" />
              <p>No volumes matching current filter.</p>
            </div>
          ) : (
            <div className="lib-idx-book-table">
              {filteredBooks.map((book) => {
                const total = book.totalPages || 0;
                const nativePct = total > 0 ? (book.nativePages / total) * 100 : 0;
                const ocrPct = total > 0 ? (book.ocrPages / total) * 100 : 0;
                const blankPct = total > 0 ? (book.blankPages / total) * 100 : 0;

                const isCurrentProcessing = book.status === 'PROCESSING';
                const isCurrentPending = book.status === 'PENDING';

                return (
                  <div key={book.bookId} className={`lib-idx-row ${isCurrentProcessing ? 'lib-idx-row--active' : ''}`}>
                    {/* Left: Book Info */}
                    <div className="lib-idx-row-main">
                      <div className="lib-idx-row-title-bar">
                        <span className="lib-idx-row-title">{book.title}</span>
                        {book.author && <span className="lib-idx-row-author">by {book.author}</span>}
                      </div>

                      {/* Visual segmented progress bar */}
                      <div className="lib-idx-row-bar-track" title={`Native: ${book.nativePages}, OCR: ${book.ocrPages}, Blank: ${book.blankPages}, Unindexed: ${book.unindexedPages}`}>
                        <div
                          className="lib-idx-bar-segment lib-idx-bar-segment--native"
                          style={{ width: `${nativePct}%` }}
                        />
                        <div
                          className="lib-idx-bar-segment lib-idx-bar-segment--ocr"
                          style={{ width: `${ocrPct}%` }}
                        />
                        <div
                          className="lib-idx-bar-segment lib-idx-bar-segment--blank"
                          style={{ width: `${blankPct}%` }}
                        />
                      </div>

                      {/* Coverage metrics numbers */}
                      <div className="lib-idx-row-metrics">
                        <span>
                          <strong>{book.indexedPages}</strong> of <strong>{book.totalPages}</strong> pages indexed ({book.coveragePercent}%)
                        </span>
                        <span>•</span>
                        <span className="text-gold-light">{book.nativePages} native</span>
                        <span>•</span>
                        <span className="text-teal-light">{book.ocrPages} OCR</span>
                        {book.blankPages > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-muted">{book.blankPages} blank</span>
                          </>
                        )}
                        {book.failedPages > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-red-light font-semibold">{book.failedPages} failed</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: Status Pill & Action Button */}
                    <div className="lib-idx-row-actions">
                      {/* Status indicator */}
                      {isCurrentProcessing ? (
                        <span className="lib-idx-tag lib-idx-tag--processing">
                          <Loader2 size={12} className="rdr-spin" /> Indexing…
                        </span>
                      ) : isCurrentPending ? (
                        <span className="lib-idx-tag lib-idx-tag--pending">
                          <Clock size={12} /> Queued
                        </span>
                      ) : book.isFullyIndexed ? (
                        <span className="lib-idx-tag lib-idx-tag--success">
                          <CheckCircle2 size={12} /> 100% Indexed
                        </span>
                      ) : book.status === 'FAILED' ? (
                        <span className="lib-idx-tag lib-idx-tag--danger">
                          <AlertCircle size={12} /> Failed
                        </span>
                      ) : !book.physicalPdfExists ? (
                        <span className="lib-idx-tag lib-idx-tag--missing">
                          PDF Missing
                        </span>
                      ) : book.indexedPages > 0 ? (
                        <span className="lib-idx-tag lib-idx-tag--partial">
                          Partial ({book.coveragePercent}%)
                        </span>
                      ) : (
                        <span className="lib-idx-tag lib-idx-tag--unindexed">
                          Unindexed
                        </span>
                      )}

                      {/* Action button */}
                      {book.physicalPdfExists && !isCurrentProcessing && !isCurrentPending && (
                        <button
                          type="button"
                          className="lib-idx-item-btn"
                          onClick={() => handleIndexBook(book.bookId)}
                          disabled={actionLoading}
                          title={book.isFullyIndexed ? 'Re-index volume' : 'Index unindexed pages'}
                        >
                          {book.canRetry && book.indexedPages > 0 ? (
                            <>
                              <RotateCcw size={12} /> Retry
                            </>
                          ) : (
                            <>
                              <Play size={12} /> {book.isFullyIndexed ? 'Re-index' : 'Index'}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

