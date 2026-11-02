/**
 * BookmarkHistoryModal.jsx
 * Aks (अक्स) Reading Room — Book-Specific Bookmark History Modal
 *
 * Displays all bookmarks for the currently opened book inside the Reading Room.
 * Accessible from the three-dot (⋯) menu.
 *
 * Features:
 * - Book-specific scoping (only shows bookmarks for current book)
 * - Header with book title, bookmark history title, and live total count
 * - Peacock bookmark marker on each entry
 * - Page number, formatted creation timestamp, and any custom note/label
 * - Interactive navigation: clicking any entry closes the modal and jumps to that page
 * - Live update on bookmark addition/removal
 * - Elegant midnight navy and champagne-gold literary aesthetic
 */

import React, { useEffect, useMemo } from 'react';
import {
  X,
  Sparkles,
  Calendar,
  Bookmark as BookmarkIcon,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import peacockImg from '../../assets/peacock.png';
import {
  formatBookmarkDate,
  formatBookmarkTime,
  filterBookBookmarks,
} from '../../utils/bookmarkUtils';

export { formatBookmarkDate, formatBookmarkTime, filterBookBookmarks };

export default function BookmarkHistoryModal({
  isOpen,
  onClose,
  bookmarks = [],
  book,
  currentPage = 1,
  onNavigateToPage,
  onRemoveBookmark,
}) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Book-specific bookmarks sorted in natural page reading order (ascending)
  const bookBookmarks = useMemo(() => {
    return filterBookBookmarks(bookmarks, book?.id);
  }, [bookmarks, book?.id]);

  if (!isOpen) return null;

  const currentBookTitle = book?.title || 'Current Volume';

  return (
    <div
      className="bookmark-history-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bookmark-history-modal-title"
    >
      <div
        className="bookmark-history-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bookmark-history-header">
          <div className="bookmark-history-header-title-box">
            <div className="bookmark-history-eyebrow">
              <Sparkles size={12} className="text-gold" />
              <span>Volume Chronicle</span>
            </div>
            <h2 id="bookmark-history-modal-title" className="bookmark-history-title">
              Bookmark History
            </h2>
            <div className="bookmark-history-meta-row">
              <span className="bookmark-history-book-title" title={currentBookTitle}>
                {currentBookTitle}
              </span>
              <span
                className="bookmark-history-count-badge"
                data-testid="bookmark-total-count"
              >
                Total Bookmarks: {bookBookmarks.length}
              </span>
            </div>
          </div>

          <button
            className="bookmark-history-close-btn"
            onClick={onClose}
            aria-label="Close Bookmark History dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content / Bookmark List */}
        <div className="bookmark-history-body">
          {bookBookmarks.length === 0 ? (
            <div className="bookmark-history-empty" role="status">
              <div className="bookmark-history-empty-icon-wrap">
                <BookmarkIcon size={28} className="bookmark-history-empty-icon" />
              </div>
              <h3 className="bookmark-history-empty-title">No Bookmarks in this Book</h3>
              <p className="bookmark-history-empty-desc">
                You haven&apos;t marked any pages in <em>{currentBookTitle}</em> yet.
                Use the <strong>Bookmark page</strong> option or click <strong>Mark</strong> to save pages as you read.
              </p>
            </div>
          ) : (
            <div
              className="bookmark-history-list"
              role="list"
              aria-label={`Bookmarks for ${currentBookTitle}`}
            >
              {bookBookmarks.map((bm) => {
                const formattedDate = formatBookmarkDate(bm.createdAt);
                const formattedTime = formatBookmarkTime(bm.createdAt);
                const isCurrent = Number(bm.page) === Number(currentPage);
                const hasCustomLabel =
                  bm.label &&
                  typeof bm.label === 'string' &&
                  bm.label.trim().toLowerCase() !== `page ${bm.page}`.toLowerCase();
                const hasNote = Boolean(bm.note && typeof bm.note === 'string' && bm.note.trim());

                return (
                  <div
                    key={bm.id || `bm-p${bm.page}`}
                    className={`bookmark-history-item ${isCurrent ? 'bookmark-history-item--current' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onClose();
                      onNavigateToPage?.(bm.page);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClose();
                        onNavigateToPage?.(bm.page);
                      }
                    }}
                    aria-label={`Jump to page ${bm.page}`}
                  >
                    {/* Authentic Peacock Bookmark Marker */}
                    <div className="bookmark-history-peacock-marker" title="Peacock bookmark marker">
                      <img
                        src={peacockImg || '/peacock.png'}
                        alt=""
                        className="bookmark-history-peacock-img"
                        draggable={false}
                      />
                    </div>

                    {/* Bookmark Details */}
                    <div className="bookmark-history-item-details">
                      <div className="bookmark-history-page-row">
                        <span className="bookmark-history-page-label">
                          Page {bm.page}
                        </span>
                        {isCurrent && (
                          <span className="bookmark-history-current-pill">
                            Current Page
                          </span>
                        )}
                      </div>

                      {formattedDate && (
                        <div className="bookmark-history-meta-info">
                          <span className="bookmark-history-date-str">
                            <Calendar size={12} className="bookmark-history-cal-icon" />
                            <span>{formattedDate}{formattedTime ? ` • ${formattedTime}` : ''}</span>
                          </span>
                        </div>
                      )}

                      {(hasCustomLabel || hasNote) && (
                        <div className="bookmark-history-annotation">
                          {hasCustomLabel && (
                            <span className="bookmark-history-custom-label">{bm.label}</span>
                          )}
                          {hasCustomLabel && hasNote && (
                            <span className="bookmark-history-dot-sep">•</span>
                          )}
                          {hasNote && (
                            <span className="bookmark-history-note-text">&ldquo;{bm.note}&rdquo;</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions: Direct Remove and Jump */}
                    <div className="bookmark-history-item-actions">
                      {onRemoveBookmark && (
                        <button
                          className="bookmark-history-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveBookmark(bm);
                          }}
                          title={`Remove bookmark from page ${bm.page}`}
                          aria-label={`Remove bookmark from page ${bm.page}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <div
                        className="bookmark-history-open-action"
                        title={`Navigate to page ${bm.page}`}
                      >
                        <span className="bookmark-history-open-text">Open</span>
                        <ChevronRight size={15} />
                      </div>
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
