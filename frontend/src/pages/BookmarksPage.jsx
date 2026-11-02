/**
 * BookmarksPage.jsx
 * Aks (अक्स) — Page 5: My Bookmarks
 *
 * Dedicated sanctuary dashboard for saved bookmark passages.
 * Supports:
 *   - Real IndexedDB persistence and synchronization
 *   - Search across bookmark titles, notes, and associated books
 *   - Filtering by book volume and sorting (recently added, page number, title)
 *   - Grid and List responsive layouts
 *   - Peacock / Feather marker personalization
 *   - Editing notes, labels, and chapters
 *   - Removing bookmarks with confirmation modal
 *   - "Resume Reading" launching the Reading Room directly at the bookmarked page/spread
 */
import React, { useState, useMemo } from 'react';
import {
  Feather,
  Bookmark as BookmarkIcon,
  Search,
  X,
  LayoutGrid,
  List as ListIcon,
  ArrowUpDown,
  BookOpen,
  Edit2,
  Trash2,
  Home,
  ChevronRight,
  Sparkles,
  Calendar,
  AlertCircle,
  Check,
  RotateCcw,
} from 'lucide-react';
import '../styles/bookmarks.css';

const COLOR_OPTIONS = [
  { id: 'gold', label: 'Champagne Gold', bg: '#E7C18A', text: '#1a1207' },
  { id: 'teal', label: 'Peacock Teal', bg: '#2DD4BF', text: '#042f2e' },
  { id: 'emerald', label: 'Deep Emerald', bg: '#4ADE80', text: '#052e16' },
  { id: 'amber', label: 'Warm Amber', bg: '#FBBF24', text: '#291a02' },
  { id: 'indigo', label: 'Royal Indigo', bg: '#818CF8', text: '#1e1b4b' },
];

export default function BookmarksPage({
  books = [],
  onOpenBook,
  onNavigateTo,
  onUpdateBook,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookFilter, setSelectedBookFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recently-added');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  const [scopeFilter, setScopeFilter] = useState('all'); // 'all' | 'saved' | 'sample'

  // Modals state
  const [editingBookmark, setEditingBookmark] = useState(null);
  const [editFormData, setEditFormData] = useState({
    label: '',
    chapter: '',
    note: '',
    color: 'gold',
  });

  const [deletingBookmark, setDeletingBookmark] = useState(null);

  // ── 1. Aggregate All Bookmarks from Books Collection ───────────────────────
  const allBookmarks = useMemo(() => {
    const list = [];
    books.forEach((book) => {
      const bms = book.bookmarks || [];
      bms.forEach((bm) => {
        const isSampleBookmark =
          !book.isUserImported &&
          (bm.id === 'bm-dsa-5' || bm.id === 'bm-dsa-12' || bm.id === 'bm-dsa-28' || bm.isSample === true);

        list.push({
          id: bm.id || `${book.id}-p${bm.page}`,
          bookId: book.id,
          bookTitle: book.title,
          bookAuthor: book.author || 'Academic Series',
          bookCategory: book.category || 'General',
          bookCoverTheme: book.coverTheme || {
            primary: '#1D2A44',
            accent: '#E7C18A',
            initials: book.title.slice(0, 2).toUpperCase(),
          },
          bookFormat: book.format || 'PDF',
          page: bm.page,
          label: bm.label || `Page ${bm.page}`,
          note: bm.note || '',
          chapter: bm.chapter || '',
          createdAt: bm.createdAt || new Date().toISOString(),
          color: bm.color || 'gold',
          isSample: isSampleBookmark,
          book,
        });
      });
    });
    return list;
  }, [books]);

  const userBookmarksCount = useMemo(
    () => allBookmarks.filter((bm) => !bm.isSample).length,
    [allBookmarks]
  );

  const sampleBookmarksCount = useMemo(
    () => allBookmarks.filter((bm) => bm.isSample).length,
    [allBookmarks]
  );

  // List of books that currently possess bookmarks (for filter dropdown)
  const booksWithBookmarks = useMemo(() => {
    const map = new Map();
    allBookmarks.forEach((bm) => {
      if (!map.has(bm.bookId)) {
        map.set(bm.bookId, {
          id: bm.bookId,
          title: bm.bookTitle,
          count: 1,
        });
      } else {
        map.get(bm.bookId).count += 1;
      }
    });
    return Array.from(map.values());
  }, [allBookmarks]);

  // ── 2. Filter & Sort Bookmarks ─────────────────────────────────────────────
  const filteredBookmarks = useMemo(() => {
    return allBookmarks
      .filter((bm) => {
        // Scope filter: all | saved | sample
        if (scopeFilter === 'saved' && bm.isSample) return false;
        if (scopeFilter === 'sample' && !bm.isSample) return false;

        // Book volume filter
        if (selectedBookFilter !== 'all' && bm.bookId !== selectedBookFilter) {
          return false;
        }

        // Search text query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchesLabel = bm.label.toLowerCase().includes(q);
          const matchesNote = bm.note.toLowerCase().includes(q);
          const matchesChapter = bm.chapter.toLowerCase().includes(q);
          const matchesBook = bm.bookTitle.toLowerCase().includes(q);
          const matchesAuthor = bm.bookAuthor.toLowerCase().includes(q);
          const matchesPage = `page ${bm.page}`.includes(q) || String(bm.page) === q;

          if (
            !matchesLabel &&
            !matchesNote &&
            !matchesChapter &&
            !matchesBook &&
            !matchesAuthor &&
            !matchesPage
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'recently-added') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortBy === 'page-asc') {
          return a.page - b.page;
        }
        if (sortBy === 'page-desc') {
          return b.page - a.page;
        }
        if (sortBy === 'book-title') {
          return a.bookTitle.localeCompare(b.bookTitle);
        }
        if (sortBy === 'label-asc') {
          return a.label.localeCompare(b.label);
        }
        return 0;
      });
  }, [allBookmarks, scopeFilter, selectedBookFilter, searchQuery, sortBy]);

  // ── 3. Resume Reading Action ───────────────────────────────────────────────
  const handleResumeReading = (bookmark) => {
    const targetBook = books.find((b) => b.id === bookmark.bookId) || bookmark.book;
    if (targetBook && onOpenBook) {
      onOpenBook(targetBook, bookmark.page);
    }
  };

  // ── 4. Edit Bookmark Flow ─────────────────────────────────────────────────
  const handleOpenEditModal = (bookmark) => {
    setEditingBookmark(bookmark);
    setEditFormData({
      label: bookmark.label,
      chapter: bookmark.chapter,
      note: bookmark.note,
      color: bookmark.color || 'gold',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingBookmark || !onUpdateBook) return;

    const book = books.find((b) => b.id === editingBookmark.bookId);
    if (!book) return;

    const currentBookmarks = book.bookmarks || [];
    const updated = currentBookmarks.map((bm) => {
      if (
        (bm.id && bm.id === editingBookmark.id) ||
        bm.page === editingBookmark.page
      ) {
        return {
          ...bm,
          label: editFormData.label.trim() || `Page ${bm.page}`,
          chapter: editFormData.chapter.trim(),
          note: editFormData.note.trim(),
          color: editFormData.color,
        };
      }
      return bm;
    });

    await onUpdateBook(book.id, {
      bookmarks: updated,
      bookmarksCount: updated.length,
    });

    setEditingBookmark(null);
  };

  // ── 5. Remove Bookmark Flow ───────────────────────────────────────────────
  const handleOpenDeleteModal = (bookmark) => {
    setDeletingBookmark(bookmark);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBookmark || !onUpdateBook) return;

    const book = books.find((b) => b.id === deletingBookmark.bookId);
    if (book) {
      const currentBookmarks = book.bookmarks || [];
      const updated = currentBookmarks.filter((bm) => {
        if (bm.id && deletingBookmark.id) {
          return bm.id !== deletingBookmark.id;
        }
        return bm.page !== deletingBookmark.page;
      });

      await onUpdateBook(book.id, {
        bookmarks: updated,
        bookmarksCount: updated.length,
      });
    }

    setDeletingBookmark(null);
  };

  // Helper to format date
  const formatDate = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (_) {
      return '';
    }
  };

  const isFiltered =
    searchQuery.trim().length > 0 || selectedBookFilter !== 'all';

  return (
    <div className="bookmarks-page-container">
      {/* ── 1. Breadcrumb ──────────────────────────────────────────────────── */}
      <nav className="bookmarks-breadcrumb" aria-label="Page breadcrumb">
        <button
          className="breadcrumb-link"
          onClick={() => onNavigateTo && onNavigateTo('home')}
        >
          <Home size={13} />
          <span>Home</span>
        </button>
        <ChevronRight size={13} className="breadcrumb-sep" />
        <span className="breadcrumb-current">My Bookmarks</span>
      </nav>

      {/* ── 2. Editorial Header ────────────────────────────────────────────── */}
      <header className="bookmarks-header-section">
        <div className="bookmarks-header-text">
          <div className="bookmarks-badge-row">
            <span className="bookmarks-badge">
              <Feather size={13} className="text-gold" />
              Sanctuary Marks
            </span>
            <span className="bookmarks-count-pill">
              {userBookmarksCount} {userBookmarksCount === 1 ? 'saved bookmark' : 'saved bookmarks'}
              {sampleBookmarksCount > 0 ? ` · ${sampleBookmarksCount} sample references` : ''}
            </span>
          </div>

          <h1 className="bookmarks-title">My Bookmarks</h1>
          <p className="bookmarks-subtitle">
            Your favourite passages, always within reach.
          </p>
        </div>

        <div className="bookmarks-header-actions">
          {/* Grid and List view toggle */}
          <div
            className="view-toggle-group"
            role="radiogroup"
            aria-label="Layout view mode"
          >
            <button
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Switch to Grid view"
              title="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="Switch to List view"
              title="List View"
            >
              <ListIcon size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── 3. Functional Toolbar: Search, Filter, Sort ─────────────────────── */}
      <section
        className="bookmarks-toolbar-card"
        aria-label="Bookmarks filters and search"
      >
        <div className="bookmarks-toolbar-top">
          {/* Search bar */}
          <div className="bookmarks-search-box">
            <Search size={16} className="bookmarks-search-icon" />
            <input
              type="text"
              className="bookmarks-search-input"
              placeholder="Search bookmark labels, passages, chapters, or book titles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search bookmarks"
            />
            {searchQuery && (
              <button
                className="bookmarks-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search text"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter by Book Dropdown */}
          <div className="bookmarks-filter-control">
            <BookOpen size={14} className="text-gold" />
            <select
              className="bookmarks-select"
              value={selectedBookFilter}
              onChange={(e) => setSelectedBookFilter(e.target.value)}
              aria-label="Filter by book volume"
            >
              <option value="all">All Volumes ({allBookmarks.length})</option>
              {booksWithBookmarks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.count})
                </option>
              ))}
            </select>
          </div>

          {/* Sort Dropdown */}
          <div className="bookmarks-filter-control">
            <ArrowUpDown size={14} className="text-gold" />
            <select
              className="bookmarks-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort bookmarks by"
            >
              <option value="recently-added">Recently Added</option>
              <option value="page-asc">Page Number (Low → High)</option>
              <option value="page-desc">Page Number (High → Low)</option>
              <option value="book-title">Book Title (A–Z)</option>
              <option value="label-asc">Bookmark Name (A–Z)</option>
            </select>
          </div>
        </div>

        {/* Scope Filter Pills: All vs Saved vs Sample */}
        <div className="bookmarks-pills-row" role="tablist" aria-label="Bookmark source category filter">
          <button
            className={`bookmarks-pill-btn ${scopeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setScopeFilter('all')}
          >
            <span>All Bookmarks</span>
            <span className="bookmarks-pill-count">({allBookmarks.length})</span>
          </button>
          <button
            className={`bookmarks-pill-btn ${scopeFilter === 'saved' ? 'active' : ''}`}
            onClick={() => setScopeFilter('saved')}
          >
            <Check size={12} className="text-teal" />
            <span>My Saved Bookmarks</span>
            <span className="bookmarks-pill-count">({userBookmarksCount})</span>
          </button>
          {sampleBookmarksCount > 0 && (
            <button
              className={`bookmarks-pill-btn ${scopeFilter === 'sample' ? 'active' : ''}`}
              onClick={() => setScopeFilter('sample')}
            >
              <span>Sample References</span>
              <span className="bookmarks-pill-count">({sampleBookmarksCount})</span>
            </button>
          )}
        </div>

        {/* Filter Pills: Quick volume selection */}
        {booksWithBookmarks.length > 1 && (
          <div
            className="bookmarks-pills-row bookmarks-pills-row--volumes"
            role="tablist"
            aria-label="Volume filters"
          >
            <span className="bookmarks-pills-label">Volume:</span>
            <button
              className={`bookmarks-pill-btn ${
                selectedBookFilter === 'all' ? 'active' : ''
              }`}
              onClick={() => setSelectedBookFilter('all')}
            >
              <span>All Volumes</span>
              <span className="bookmarks-pill-count">
                ({allBookmarks.length})
              </span>
            </button>
            {booksWithBookmarks.map((b) => (
              <button
                key={b.id}
                className={`bookmarks-pill-btn ${
                  selectedBookFilter === b.id ? 'active' : ''
                }`}
                onClick={() => setSelectedBookFilter(b.id)}
              >
                <span>{b.title}</span>
                <span className="bookmarks-pill-count">({b.count})</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── 4. Main Collection or Empty State ───────────────────────────────── */}
      {filteredBookmarks.length > 0 ? (
        <section
          className={
            viewMode === 'grid' ? 'bookmarks-grid' : 'bookmarks-list'
          }
          aria-label="Saved bookmarks collection"
        >
          {filteredBookmarks.map((bm) => (
            <article
              key={bm.id}
              className={`bookmark-card ${
                viewMode === 'list' ? 'bookmark-card--list' : ''
              }`}
            >
              {/* Peacock Ribbon Marker */}
              <div
                className={`bookmark-ribbon-tag bookmark-ribbon-tag--${
                  bm.color || 'gold'
                }`}
                title={`Marker: ${bm.color || 'gold'}`}
                aria-hidden="true"
              >
                <Feather size={14} />
              </div>

              {/* Book Info & Page Badge */}
              <div className="bookmark-card-header">
                <div
                  className="bookmark-book-mini-cover"
                  style={{
                    backgroundColor: bm.bookCoverTheme?.primary || '#141f33',
                    borderColor: bm.bookCoverTheme?.accent || '#E7C18A',
                  }}
                  aria-hidden="true"
                >
                  {bm.bookCoverTheme?.initials ||
                    bm.bookTitle.slice(0, 2).toUpperCase()}
                </div>

                <div className="bookmark-header-meta">
                  <span className="bookmark-book-title" title={bm.bookTitle}>
                    {bm.bookTitle}
                  </span>
                  <div className="bookmark-page-badge-wrap">
                    <div className="bookmark-page-badge">
                      <BookmarkIcon size={11} />
                      <span>Page {bm.page}</span>
                    </div>
                    {bm.isSample ? (
                      <span className="bookmark-type-tag bookmark-type-tag--sample" title="Curated demonstration reference">
                        Sample Reference
                      </span>
                    ) : (
                      <span className="bookmark-type-tag bookmark-type-tag--saved" title="Saved library document">
                        <Check size={10} /> Saved Book
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bookmark Details */}
              <div className="bookmark-card-body">
                <h3 className="bookmark-label-title">{bm.label}</h3>

                {bm.chapter && (
                  <div className="bookmark-chapter-info">
                    <Sparkles size={12} />
                    <span>{bm.chapter}</span>
                  </div>
                )}

                {bm.note && (
                  <blockquote className="bookmark-note-quote">
                    "{bm.note}"
                  </blockquote>
                )}

                {bm.createdAt && (
                  <div className="bookmark-date-row">
                    <Calendar size={11} />
                    <span>Saved {formatDate(bm.createdAt)}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <footer className="bookmark-card-footer">
                <button
                  className="bookmark-resume-btn"
                  onClick={() => handleResumeReading(bm)}
                  title={`Open ${bm.bookTitle} at page ${bm.page}`}
                >
                  <BookOpen size={14} />
                  <span>Resume Reading</span>
                </button>

                <div className="bookmark-secondary-actions">
                  <button
                    className="bookmark-icon-action-btn"
                    onClick={() => handleOpenEditModal(bm)}
                    title="Edit bookmark label or notes"
                    aria-label={`Edit bookmark for page ${bm.page}`}
                  >
                    <Edit2 size={14} />
                  </button>

                  <button
                    className="bookmark-icon-action-btn delete-btn"
                    onClick={() => handleOpenDeleteModal(bm)}
                    title="Remove this bookmark"
                    aria-label={`Remove bookmark for page ${bm.page}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </section>
      ) : (
        /* ── Empty State ─────────────────────────────────────────────────── */
        <div className="bookmarks-empty-state" role="status">
          <div className="bookmarks-empty-halo">
            <Feather size={32} />
          </div>

          <h2 className="bookmarks-empty-title">
            {isFiltered ? 'No Matching Bookmarks Found' : 'No Bookmarks Saved Yet'}
          </h2>

          <p className="bookmarks-empty-desc">
            {isFiltered
              ? `No bookmarks match your search "${searchQuery}" or selected volume filter.`
              : 'While reading in the Reading Room, click the bookmark ribbon icon in the top toolbar or dog-ear any page corner to save your favourite passages here.'}
          </p>

          {isFiltered ? (
            <button
              className="btn-secondary"
              onClick={() => {
                setSearchQuery('');
                setSelectedBookFilter('all');
              }}
            >
              <RotateCcw size={14} />
              <span>Reset Filters</span>
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={() => onNavigateTo && onNavigateTo('library')}
            >
              <BookOpen size={15} />
              <span>Explore My Library</span>
            </button>
          )}
        </div>
      )}

      {/* ── 5. Edit Bookmark Modal ─────────────────────────────────────────── */}
      {editingBookmark && (
        <div
          className="bookmark-modal-overlay"
          onClick={() => setEditingBookmark(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-bookmark-modal-title"
        >
          <div
            className="bookmark-modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bookmark-modal-header">
              <h2
                id="edit-bookmark-modal-title"
                className="bookmark-modal-title"
              >
                Edit Bookmark
              </h2>
              <button
                className="bookmark-modal-close"
                onClick={() => setEditingBookmark(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </header>

            <div className="bookmark-modal-body">
              {/* Context info banner */}
              <div className="bookmark-page-badge">
                <BookmarkIcon size={12} />
                <span>
                  {editingBookmark.bookTitle} — Page {editingBookmark.page}
                </span>
              </div>

              {/* Label Field */}
              <div className="bookmark-form-field">
                <label className="bookmark-form-label" htmlFor="bm-edit-label">
                  Bookmark Title / Label
                </label>
                <input
                  id="bm-edit-label"
                  type="text"
                  className="bookmark-form-input"
                  value={editFormData.label}
                  placeholder={`Page ${editingBookmark.page}`}
                  onChange={(e) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      label: e.target.value,
                    }))
                  }
                />
              </div>

              {/* Chapter Field */}
              <div className="bookmark-form-field">
                <label
                  className="bookmark-form-label"
                  htmlFor="bm-edit-chapter"
                >
                  Chapter or Section (Optional)
                </label>
                <input
                  id="bm-edit-chapter"
                  type="text"
                  className="bookmark-form-input"
                  value={editFormData.chapter}
                  placeholder="e.g. Chapter 3: Search Trees"
                  onChange={(e) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      chapter: e.target.value,
                    }))
                  }
                />
              </div>

              {/* Note / Quote Field */}
              <div className="bookmark-form-field">
                <label className="bookmark-form-label" htmlFor="bm-edit-note">
                  Personal Note or Passage Excerpt
                </label>
                <textarea
                  id="bm-edit-note"
                  className="bookmark-form-textarea"
                  value={editFormData.note}
                  placeholder="Add a key quote, derivation, or reason for bookmarking..."
                  onChange={(e) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      note: e.target.value,
                    }))
                  }
                />
              </div>

              {/* Peacock Marker Color Swatches */}
              <div className="bookmark-form-field">
                <label className="bookmark-form-label">
                  Marker Ribbon Color
                </label>
                <div className="bookmark-color-options">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`bookmark-color-swatch ${
                        editFormData.color === c.id ? 'active' : ''
                      }`}
                      style={{ backgroundColor: c.bg }}
                      onClick={() =>
                        setEditFormData((prev) => ({ ...prev, color: c.id }))
                      }
                      title={c.label}
                      aria-label={c.label}
                    >
                      {editFormData.color === c.id && (
                        <Check size={14} color={c.text} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <footer className="bookmark-modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setEditingBookmark(null)}
              >
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSaveEdit}>
                <Check size={14} />
                <span>Save Changes</span>
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ── 6. Delete Confirmation Modal ───────────────────────────────────── */}
      {deletingBookmark && (
        <div
          className="bookmark-modal-overlay"
          onClick={() => setDeletingBookmark(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-bookmark-modal-title"
        >
          <div
            className="bookmark-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460 }}
          >
            <header className="bookmark-modal-header">
              <h2
                id="delete-bookmark-modal-title"
                className="bookmark-modal-title"
              >
                Remove Bookmark?
              </h2>
              <button
                className="bookmark-modal-close"
                onClick={() => setDeletingBookmark(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </header>

            <div className="bookmark-modal-body">
              <p
                style={{
                  fontSize: '0.92rem',
                  lineHeight: '1.6',
                  color: 'var(--text-secondary)',
                  margin: 0,
                }}
              >
                Are you sure you want to remove your bookmark for{' '}
                <strong style={{ color: 'var(--accent-gold)' }}>
                  Page {deletingBookmark.page}
                </strong>{' '}
                of <em>"{deletingBookmark.bookTitle}"</em>?
              </p>
              <p
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                This passage can be re-added anytime while reading in the Reading
                Room.
              </p>
            </div>

            <footer className="bookmark-modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setDeletingBookmark(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{
                  background: '#e05252',
                  borderColor: '#ef4444',
                  color: '#fff',
                }}
                onClick={handleConfirmDelete}
              >
                <Trash2 size={14} />
                <span>Remove Bookmark</span>
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
