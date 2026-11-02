import React, { useState } from 'react';
import {
  X,
  BookOpen,
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  BookmarkPlus,
  CheckCircle2,
} from 'lucide-react';
import BookCover from './BookCover';
import { calculateProgress } from '../data/mockBooks';

export default function ReaderModal({
  book,
  onClose,
  onUpdateProgress,
  onSaveUnsavedBook,
  isSavedInLibrary = true,
}) {
  const [activePage, setActivePage] = useState(book?.currentPage || 1);
  const [hasSavedLocally, setHasSavedLocally] = useState(isSavedInLibrary);

  if (!book) return null;

  const totalPages = Math.max(1, book.totalPages || 1);
  const progress = calculateProgress(activePage, totalPages);

  const handlePageChange = (newPage) => {
    const clamped = Math.max(1, Math.min(totalPages, newPage));
    setActivePage(clamped);
    if (onUpdateProgress && book.id) {
      onUpdateProgress(book.id, clamped);
    }
  };

  const handleSaveBook = async () => {
    if (onSaveUnsavedBook) {
      await onSaveUnsavedBook({
        ...book,
        currentPage: activePage,
      });
      setHasSavedLocally(true);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="reader-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-left">
            <button
              className="modal-back-btn"
              onClick={onClose}
              aria-label="Back to sanctuary"
            >
              <ArrowLeft size={18} />
              <span>Back to Sanctuary</span>
            </button>
          </div>

          <div className="modal-badge-status">
            <AlertCircle size={14} />
            <span>Reader Engine Placeholder (Page 2 Scope)</span>
          </div>

          <button
            className="modal-close-icon-btn"
            onClick={onClose}
            aria-label="Close reader preview"
          >
            <X size={20} />
          </button>
        </div>

        <div className="reader-modal-body">
          <div className="reader-preview-sidebar">
            <BookCover
              title={book.title}
              theme={book.coverTheme}
              coverUrl={book.coverUrl || book.coverImage || book.coverTheme?.coverUrl || book.coverTheme?.coverImage}
              size="medium"
            />
            <div className="reader-meta-summary">
              <h4>{book.title}</h4>
              <p className="reader-author">{book.author || 'Personal Document'}</p>
              
              <div className="reader-stat-row">
                <span>Reading position:</span>
                <strong>Page {activePage} of {totalPages}</strong>
              </div>
              <div className="reader-stat-row">
                <span>Progress:</span>
                <strong>{progress}%</strong>
              </div>
              
              <div className="modal-progress-bar">
                <div
                  className="modal-progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Quick Save button if user opened via Read Now without saving */}
              {!hasSavedLocally && (
                <button
                  type="button"
                  className="reader-save-prompt-btn"
                  onClick={handleSaveBook}
                  style={{ marginTop: '12px', width: '100%', justifyContent: 'center' }}
                >
                  <BookmarkPlus size={15} />
                  <span>Save to My Library</span>
                </button>
              )}
            </div>
          </div>

          <div className="reader-preview-canvas">
            <div className="reader-canvas-paper">
              <div className="canvas-header-mock">
                <span>{book.title}</span>
                <span>Page {activePage} of {totalPages}</span>
              </div>

              <div className="canvas-content-mock">
                <p className="canvas-lead-para">
                  Reading checkpoint loaded at <strong>Page {activePage}</strong>.
                  {book.isUserImported && (
                    <span> This volume is loaded from your local PDF file: <em>{book.filename}</em>.</span>
                  )}
                </p>

                <div className="canvas-skeleton-lines">
                  <div className="skeleton-line line-full" />
                  <div className="skeleton-line line-3-4" />
                  <div className="skeleton-line line-full" />
                  <div className="skeleton-line line-half" />
                </div>

                <div className="reader-scope-notice">
                  <BookOpen size={24} className="notice-icon" />
                  <h5>Immersive PDF Canvas Reader (Screen 2 Engine)</h5>
                  <p>
                    Full PDF canvas rendering, font scaling, marginalia tools, and text selection
                    are part of Screen 2.
                    Your reading position at <strong>Page {activePage} of {totalPages}</strong> is
                    saved and persisted in IndexedDB.
                  </p>
                </div>
              </div>

              {/* Real Reading Position Navigator */}
              <div className="reader-page-nav-bar">
                <div className="reader-page-controls-group">
                  <button
                    className="reader-nav-btn"
                    onClick={() => handlePageChange(activePage - 1)}
                    disabled={activePage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                    <span>Prev</span>
                  </button>

                  <span className="reader-page-indicator">
                    Page <strong>{activePage}</strong> of {totalPages}
                  </span>

                  <button
                    className="reader-nav-btn"
                    onClick={() => handlePageChange(activePage + 1)}
                    disabled={activePage >= totalPages}
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>

                <div className="reader-save-status">
                  <span className="text-teal" style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={13} />
                    Position synced to local store
                  </span>
                </div>
              </div>

              <div className="canvas-footer-mock" style={{ marginTop: '12px' }}>
                <span>Aks Digital Sanctuary Edition</span>
                <span>Press Esc to return</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-footer-caption">
            Active volume: {book.title} ({book.format || 'PDF'}, {totalPages} pages)
          </span>
          <button className="btn-primary" onClick={onClose}>
            Return to Sanctuary
          </button>
        </div>
      </div>
    </div>
  );
}
