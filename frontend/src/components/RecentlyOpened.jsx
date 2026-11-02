import React from 'react';
import { ArrowRight, Clock, BookOpen } from 'lucide-react';
import BookCover from './BookCover';
import { calculateProgress } from '../data/mockBooks';

export default function RecentlyOpened({
  books = [],
  onOpenBook,
  onViewAllLibrary,
}) {
  return (
    <section className="recently-opened-section" aria-label="Recently opened books">
      <div className="section-header-row">
        <div className="section-title-wrap">
          <h3 className="section-heading">Recently Opened</h3>
          <span className="section-count-pill">
            {books.length > 0 ? `${books.length} in reading list` : 'No recent activity'}
          </span>
        </div>

        {books.length > 0 && (
          <button
            className="section-link-btn"
            onClick={onViewAllLibrary}
            aria-label="View all books in library"
          >
            <span>View All</span>
            <ArrowRight size={15} />
          </button>
        )}
      </div>

      {books.length === 0 ? (
        <div className="recent-books-empty">
          <div className="recent-empty-icon-ring">
            <Clock size={18} className="recent-empty-icon" />
          </div>
          <p className="recent-empty-text">
            Books you open will appear here for easy access.
          </p>
        </div>
      ) : (
        <div className="recent-books-grid">
          {books.map((book) => {
            const progress = calculateProgress(book.currentPage, book.totalPages);

            return (
              <div
                key={book.id}
                className="recent-book-card"
                onClick={() => onOpenBook(book)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenBook(book);
                  }
                }}
                aria-label={`Open ${book.title}`}
              >
                <div className="recent-cover-box">
                  <BookCover
                    title={book.title}
                    theme={book.coverTheme}
                    coverUrl={book.coverUrl || book.coverImage || book.coverTheme?.coverUrl || book.coverTheme?.coverImage}
                    size="small"
                  />
                </div>

                <div className="recent-info-block">
                  <div className="recent-meta-top">
                    <span className="recent-category">{book.category}</span>
                    <span className="recent-pages-tag">{book.totalPages} pages</span>
                  </div>

                  <h4 className="recent-book-title" title={book.title}>
                    {book.title}
                  </h4>

                  <div className="recent-progress-container">
                    <div className="recent-progress-labels">
                      <span className="recent-progress-pages">
                        <strong>{book.currentPage}</strong> / {book.totalPages}
                      </span>
                      <span className="recent-progress-pct">{progress}%</span>
                    </div>

                    <div className="recent-progress-track">
                      <div
                        className="recent-progress-bar"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="recent-footer-time">
                    <Clock size={12} />
                    <span>{book.lastOpened}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
