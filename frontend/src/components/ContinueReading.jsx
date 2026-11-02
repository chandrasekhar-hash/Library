import React, { useState } from 'react';
import { ArrowRight, MoreVertical, Share2, Info, BookOpen, Upload } from 'lucide-react';
import BookCover from './BookCover';
import { calculateProgress } from '../data/mockBooks';

export default function ContinueReading({ book, onContinueReading, onTriggerImport }) {
  const [showMenu, setShowMenu] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);

  if (!book) {
    return (
      <div className="continue-reading-card continue-reading-card--empty" aria-label="Reading sanctuary empty state">
        <div className="continue-empty-sanctuary">
          <div className="continue-empty-icon-halo">
            <BookOpen size={30} className="continue-empty-icon" />
          </div>
          <div className="continue-empty-text-wrap">
            <h3 className="continue-empty-title">Your Reading Sanctuary Awaits</h3>
            <p className="continue-empty-subtitle">
              Your library is empty. Bring your first book here and begin a new chapter.
            </p>
          </div>
          <button
            className="btn-primary continue-empty-import-btn"
            onClick={onTriggerImport}
          >
            <Upload size={16} />
            <span>Import Your First Book</span>
          </button>
        </div>
      </div>
    );
  }

  const {
    title,
    totalPages,
    currentPage = 0,
    format = 'PDF',
    category = 'General',
    coverTheme,
  } = book;

  const progressPercent = calculateProgress(currentPage, totalPages);

  const handleShare = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2400);
  };

  return (
    <div className="continue-reading-card" aria-label="Continue reading section">
      <div className="continue-card-inner">
        {/* Book cover visual */}
        <div
          className="continue-cover-wrapper"
          onClick={() => onContinueReading(book)}
          role="button"
          tabIndex={0}
          aria-label={`Open reader for ${title}`}
          onKeyDown={(e) => e.key === 'Enter' && onContinueReading(book)}
        >
          <BookCover
            title={title}
            theme={coverTheme}
            coverUrl={book?.coverUrl || book?.coverImage || coverTheme?.coverUrl || coverTheme?.coverImage}
            size="large"
            aspectRatio="portrait"
          />
        </div>

        {/* Book details & reading stats */}
        <div className="continue-info-col">
          <div className="continue-top-meta">
            <div className="badge-group">
              <span className="format-badge">{format}</span>
              <span className="category-badge">{category}</span>
            </div>

            <div className="continue-menu-relative">
              <button
                className="icon-btn-ghost"
                onClick={() => setShowMenu(!showMenu)}
                aria-label="More options for this book"
              >
                <MoreVertical size={18} />
              </button>

              {showMenu && (
                <div className="continue-dropdown-menu">
                  <button
                    className="menu-option-btn"
                    onClick={() => {
                      setShowMenu(false);
                      onContinueReading(book);
                    }}
                  >
                    <Info size={15} />
                    <span>Book Overview</span>
                  </button>
                  <button
                    className="menu-option-btn"
                    onClick={handleShare}
                  >
                    <Share2 size={15} />
                    <span>Copy Reference Link</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <h3
            className="continue-book-title"
            onClick={() => onContinueReading(book)}
          >
            {title}
          </h3>

          <p className="continue-meta-caption">
            {currentPage > 0 ? `Resume reading on page ${currentPage}` : 'Ready to begin reading'}
          </p>

          {/* Reading Progress block */}
          <div className="continue-progress-box">
            <div className="progress-labels-row">
              <span className="progress-page-count">
                <strong>{currentPage}</strong> / {totalPages} pages
              </span>
              <span className="progress-percent-val">{progressPercent}% complete</span>
            </div>

            <div className="progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
              <div
                className="progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Action Row */}
          <div className="continue-actions-row">
            <button
              className="btn-primary continue-btn"
              onClick={() => onContinueReading(book)}
            >
              <span>{currentPage > 0 ? 'Continue Reading' : 'Start Reading'}</span>
              <ArrowRight size={17} />
            </button>

            {copiedNotification && (
              <span className="copied-toast">Link copied to clipboard!</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
