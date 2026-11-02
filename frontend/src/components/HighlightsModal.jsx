import React, { useState, useMemo } from 'react';
import {
  X,
  Highlighter,
  BookOpen,
  Trash2,
  Search,
  Filter,
  Calendar,
  Layers,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

const HIGHLIGHT_COLOR_FILTERS = [
  { id: 'all', label: 'All Colors', bg: 'transparent' },
  { id: 'gold', label: 'Gold', bg: '#E7C18A' },
  { id: 'teal', label: 'Teal', bg: '#67B8A2' },
  { id: 'emerald', label: 'Emerald', bg: '#4E9E7A' },
  { id: 'amber', label: 'Amber', bg: '#D99863' },
  { id: 'indigo', label: 'Indigo', bg: '#869DEE' },
  { id: 'rose', label: 'Rose', bg: '#E06D85' },
];

export default function HighlightsModal({
  isOpen,
  onClose,
  books = [],
  onOpenBook,
  onDeleteHighlight,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColor, setSelectedColor] = useState('all');

  // Aggregate highlights across all library books
  const allHighlights = useMemo(() => {
    const list = [];
    books.forEach((b) => {
      if (Array.isArray(b.highlights)) {
        b.highlights.forEach((hl) => {
          list.push({
            ...hl,
            bookId: b.id,
            bookTitle: b.title,
            book: b,
          });
        });
      }
    });
    return list.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
  }, [books]);

  // Filter highlights
  const filteredHighlights = useMemo(() => {
    return allHighlights.filter((hl) => {
      const matchesSearch =
        !searchQuery.trim() ||
        (hl.text && hl.text.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (hl.bookTitle &&
          hl.bookTitle.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesColor =
        selectedColor === 'all' || hl.color === selectedColor;

      return matchesSearch && matchesColor;
    });
  }, [allHighlights, searchQuery, selectedColor]);

  if (!isOpen) return null;

  const formatDate = (isoString) => {
    if (!isoString) return 'Saved';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Saved';
    }
  };

  return (
    <div
      className="library-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="highlights-modal-title"
    >
      <div
        className="highlights-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="highlights-modal-header">
          <div className="highlights-header-left">
            <div className="highlights-halo gold-halo">
              <Highlighter size={22} />
            </div>
            <div>
              <h3 id="highlights-modal-title" className="highlights-title">
                My Highlights
              </h3>
              <p className="highlights-subtitle">
                {allHighlights.length}{' '}
                {allHighlights.length === 1 ? 'passage' : 'passages'} captured
                across your library
              </p>
            </div>
          </div>

          <button
            className="modal-close-icon-btn"
            onClick={onClose}
            aria-label="Close highlights modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter bar: search and color chips */}
        <div className="highlights-filter-bar">
          <div className="highlights-search-box">
            <Search size={15} className="highlights-search-icon" />
            <input
              type="text"
              className="highlights-search-input"
              placeholder="Search highlighted quotes or book titles…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search highlights"
            />
            {searchQuery && (
              <button
                className="highlights-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="highlights-color-filters" aria-label="Filter by color">
            {HIGHLIGHT_COLOR_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`highlights-color-chip ${
                  selectedColor === f.id ? 'active' : ''
                }`}
                onClick={() => setSelectedColor(f.id)}
              >
                {f.id !== 'all' && (
                  <span
                    className="highlights-chip-dot"
                    style={{ backgroundColor: f.bg }}
                  />
                )}
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Highlights List Body */}
        <div className="highlights-list-body">
          {filteredHighlights.length === 0 ? (
            <div className="highlights-empty-state">
              <div className="highlights-empty-halo">
                <Highlighter size={28} />
              </div>
              <h4>
                {allHighlights.length === 0
                  ? 'No highlights saved yet'
                  : 'No matching highlights'}
              </h4>
              <p>
                {allHighlights.length === 0
                  ? 'Open any PDF in the Reading Room, select text with your cursor, and tap Highlight to capture meaningful quotes.'
                  : 'Try selecting a different color filter or clearing your search query.'}
              </p>
            </div>
          ) : (
            <div className="highlights-grid">
              {filteredHighlights.map((hl) => (
                <article
                  key={hl.id}
                  className="highlight-entry-card"
                  style={{
                    borderLeft: `4px solid ${hl.colorHex || '#E7C18A'}`,
                  }}
                >
                  <div className="highlight-entry-top">
                    <span className="highlight-book-meta">
                      <BookOpen size={13} className="text-gold" />
                      <strong className="highlight-book-title">
                        {hl.bookTitle}
                      </strong>
                      <span className="highlight-page-badge">Page {hl.page}</span>
                    </span>

                    <span className="highlight-date-badge">
                      <Calendar size={12} />
                      <span>{formatDate(hl.createdAt)}</span>
                    </span>
                  </div>

                  <blockquote className="highlight-entry-quote">
                    “{hl.text}”
                  </blockquote>

                  <div className="highlight-entry-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm highlight-jump-btn"
                      onClick={() => {
                        onClose();
                        if (onOpenBook) {
                          onOpenBook(hl.book, hl.page);
                        }
                      }}
                      title={`Jump to page ${hl.page} in ${hl.bookTitle}`}
                    >
                      <BookOpen size={14} />
                      <span>Read in Context</span>
                      <ChevronRight size={13} />
                    </button>

                    {onDeleteHighlight && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm highlight-delete-btn"
                        onClick={() => onDeleteHighlight(hl.bookId, hl.id)}
                        title="Delete highlight"
                        aria-label="Delete this highlight"
                      >
                        <Trash2 size={13} />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="highlights-modal-footer">
          <span className="highlights-footer-count">
            Showing {filteredHighlights.length} of {allHighlights.length} highlights
          </span>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
