import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Upload,
  LayoutGrid,
  List as ListIcon,
  Filter,
  ArrowUpDown,
  MoreVertical,
  Clock,
  Sparkles,
  ArrowRight,
  FolderOpen,
  Edit2,
  Tag,
  Info,
  Bookmark,
  FileText,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import BookCover from '../components/BookCover';
import LibraryIndexingDrawer from '../components/library/LibraryIndexingDrawer';
import {
  calculateProgress,
  LIBRARY_CATEGORIES,
  READING_STATUSES,
  SORT_OPTIONS,
} from '../data/mockBooks';

export default function Library({
  books = [],
  onOpenBook,
  onTriggerImport,
  onActionSelect, // opens BookActionModals ({ type, book })
  onResetSampleBooks,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [sortBy, setSortBy] = useState('recently-read');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [isIndexingDrawerOpen, setIsIndexingDrawerOpen] = useState(false);

  // Derive available categories dynamically from imported books
  const availableCategories = useMemo(() => {
    const cats = new Set(books.map((b) => b.category).filter(Boolean));
    return ['All', ...Array.from(cats)];
  }, [books]);

  // Close dropdown on outside click
  const handleToggleMenu = (e, bookId) => {
    e.stopPropagation();
    setOpenDropdownId((prev) => (prev === bookId ? null : bookId));
  };

  const handleMenuAction = (e, type, book) => {
    e.stopPropagation();
    setOpenDropdownId(null);
    onActionSelect({ type, book });
  };

  // Check if any filters are currently active
  const isFiltered =
    searchQuery.trim().length > 0 ||
    selectedCategory !== 'All' ||
    selectedStatus !== 'all';

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedStatus('all');
  };

  // Dynamic filtered & sorted books list
  const filteredBooks = useMemo(() => {
    return books
      .filter((book) => {
        // Search filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesTitle = book.title.toLowerCase().includes(q);
          const matchesAuthor = book.author && book.author.toLowerCase().includes(q);
          const matchesCategory = book.category && book.category.toLowerCase().includes(q);
          if (!matchesTitle && !matchesAuthor && !matchesCategory) return false;
        }

        // Category filter
        if (selectedCategory !== 'All') {
          if (book.category !== selectedCategory) return false;
        }

        // Status filter
        if (selectedStatus !== 'all') {
          if (selectedStatus === 'in-progress') {
            if (book.currentPage <= 0 || book.currentPage >= book.totalPages) return false;
          } else if (selectedStatus === 'not-started') {
            if (book.currentPage > 0) return false;
          } else if (selectedStatus === 'completed') {
            if (book.currentPage < book.totalPages) return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'recently-read') {
          return (b.lastOpenedTimestamp || 0) - (a.lastOpenedTimestamp || 0);
        }
        if (sortBy === 'title-asc') {
          return a.title.localeCompare(b.title);
        }
        if (sortBy === 'title-desc') {
          return b.title.localeCompare(a.title);
        }
        if (sortBy === 'progress-desc') {
          const progA = calculateProgress(a.currentPage, a.totalPages);
          const progB = calculateProgress(b.currentPage, b.totalPages);
          return progB - progA;
        }
        if (sortBy === 'progress-asc') {
          const progA = calculateProgress(a.currentPage, a.totalPages);
          const progB = calculateProgress(b.currentPage, b.totalPages);
          return progA - progB;
        }
        return 0;
      });
  }, [books, searchQuery, selectedCategory, selectedStatus, sortBy]);

  return (
    <div className="library-page-container" onClick={() => setOpenDropdownId(null)}>
      {/* 1. Spacious Editorial Header */}
      <header className="library-header-section">
        <div className="library-header-text">
          <div className="library-badge-row">
            <span className="library-badge">
              <Sparkles size={13} className="text-gold" />
              Digital Archive
            </span>
            <span className="library-count-pill">{books.length} saved {books.length === 1 ? 'book' : 'books'}</span>
          </div>

          <h1 className="library-title">My Library</h1>
          <p className="library-subtitle">
            Your books, your progress, your place to return.
          </p>
        </div>

        <div className="library-header-actions">
          {/* Library Search Index Management button */}
          <button
            type="button"
            className="library-indexing-trigger-btn"
            onClick={() => setIsIndexingDrawerOpen(true)}
            title="Manage Full-Text Search Indexing across Library"
          >
            <Sparkles size={15} className="text-gold" />
            <span>Search Index</span>
          </button>

          {/* Prominent + Import Book button */}
          <button
            className="btn-primary import-action-btn"
            onClick={onTriggerImport}
          >
            <Upload size={17} />
            <span>+ Import Book</span>
          </button>

          {/* Grid and List view toggle */}
          <div className="view-toggle-group" role="radiogroup" aria-label="Layout view mode">
            <button
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Switch to Grid view"
              title="Grid View"
            >
              <LayoutGrid size={17} />
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="Switch to List view"
              title="List View"
            >
              <ListIcon size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. Functional Toolbar: Search, Filters & Sorting (Only when library has books) */}
      {books.length > 0 && (
        <section className="library-toolbar-card" aria-label="Library filters and search">
          <div className="toolbar-top-row">
            {/* Search bar */}
            <div className="library-search-box">
              <Search size={16} className="toolbar-search-icon" />
              <input
                type="text"
                className="toolbar-search-input"
                placeholder="Search your saved books by title, author, or topic..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search saved books"
              />
              {searchQuery && (
                <button
                  className="toolbar-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search text"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Sort dropdown */}
            <div className="toolbar-sort-wrap">
              <ArrowUpDown size={15} className="sort-icon" />
              <label htmlFor="library-sort-select" className="visually-hidden">Sort books by</label>
              <select
                id="library-sort-select"
                className="toolbar-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    Sort: {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filters Row: Categories & Reading Statuses */}
          <div className="toolbar-filters-row">
            {availableCategories.length > 1 && (
              <div className="filters-group">
                <span className="filter-group-label">Category:</span>
                <div className="filter-pills-wrap">
                  {availableCategories.map((cat) => (
                    <button
                      key={cat}
                      className={`filter-pill ${selectedCategory === cat ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="filters-group">
              <span className="filter-group-label">Status:</span>
              <div className="filter-pills-wrap">
                {READING_STATUSES.map((status) => (
                  <button
                    key={status.id}
                    className={`filter-pill ${selectedStatus === status.id ? 'active' : ''}`}
                    onClick={() => setSelectedStatus(status.id)}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear filters action */}
            {isFiltered && (
              <button
                className="clear-filters-btn"
                onClick={handleClearFilters}
                title="Reset all search and filter conditions"
              >
                <RotateCcw size={13} />
                <span>Reset Filters</span>
              </button>
            )}
          </div>

          {/* Results Counter summary */}
          <div className="toolbar-counter-row">
            <span className="counter-text">
              Showing <strong>{filteredBooks.length}</strong> of {books.length} {books.length === 1 ? 'book' : 'books'}
            </span>
            {isFiltered && (
              <span className="filters-active-tag">Filtered results active</span>
            )}
          </div>
        </section>
      )}

      {/* 3. Main Books Collection (Grid or List View) */}
      <section className="library-books-display" aria-label="Saved books collection">
        {books.length === 0 ? (
          /* State 1: Entirely empty library */
          <div className="library-empty-card">
            <div className="empty-icon-halo">
              <FolderOpen size={36} className="text-gold" />
            </div>
            <h3 className="empty-heading">Your Library is Waiting</h3>
            <p className="empty-subtext">
              Every great reading journey begins with a single book.
            </p>
            <div className="empty-actions-row">
              <button
                className="btn-primary"
                onClick={onTriggerImport}
              >
                <Upload size={17} />
                <span>Import Book</span>
              </button>
            </div>
          </div>
        ) : filteredBooks.length === 0 ? (
          /* State 2: No books matching filters / search */
          <div className="library-empty-card">
            <div className="empty-icon-halo">
              <Filter size={32} className="text-teal" />
            </div>
            <h3 className="empty-heading">No Books Found</h3>
            <p className="empty-subtext">
              No volumes in your sanctuary match "{searchQuery || `${selectedCategory} / ${selectedStatus}`}".
            </p>
            <button className="btn-secondary" onClick={handleClearFilters}>
              <RotateCcw size={15} />
              <span>Clear Search & Filters</span>
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* State 3: Grid View */
          <div className="library-grid-layout">
            {filteredBooks.map((book) => {
              const progress = calculateProgress(book.currentPage, book.totalPages);
              const isDropdownOpen = openDropdownId === book.id;
              const hasStarted = book.currentPage > 0;

              return (
                <article
                  key={book.id}
                  className="library-book-card"
                  onClick={() => onOpenBook(book)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenBook(book);
                    }
                  }}
                  aria-label={`Open reader for ${book.title}`}
                >
                  {/* Book cover with tactile styling */}
                  <div className="library-card-cover-wrap">
                    <BookCover
                      title={book.title}
                      theme={book.coverTheme}
                      coverUrl={book.coverUrl || book.coverImage || book.coverTheme?.coverUrl || book.coverTheme?.coverImage}
                      size="medium"
                    />
                  </div>

                  {/* Card Content */}
                  <div className="library-card-content">
                    <div className="library-card-meta-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="card-category-tag">{book.category}</span>
                        {book.isUserImported ? (
                          <span className="badge-user-imported">Personal PDF</span>
                        ) : (
                          <span className="badge-sample-volume">Sample Volume</span>
                        )}
                      </div>
                      <div className="card-right-group">
                        <span className="card-format-tag">{book.format}</span>
                        {/* 3-Dot Action Menu Button */}
                        <div className="card-menu-relative">
                          <button
                            className="card-more-btn"
                            onClick={(e) => handleToggleMenu(e, book.id)}
                            aria-label={`Actions for ${book.title}`}
                            aria-expanded={isDropdownOpen}
                          >
                            <MoreVertical size={17} />
                          </button>

                          {/* Action Dropdown Menu */}
                          {isDropdownOpen && (
                            <div className="book-action-dropdown" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="action-menu-item"
                                onClick={(e) => handleMenuAction(e, 'rename', book)}
                              >
                                <Edit2 size={14} />
                                <span>Rename Book</span>
                              </button>
                              <button
                                className="action-menu-item"
                                onClick={(e) => handleMenuAction(e, 'category', book)}
                              >
                                <Tag size={14} />
                                <span>Change Category</span>
                              </button>
                              <button
                                className="action-menu-item"
                                onClick={(e) => handleMenuAction(e, 'details', book)}
                              >
                                <Info size={14} />
                                <span>View Book Details</span>
                              </button>
                              <button
                                className="action-menu-item"
                                onClick={(e) => handleMenuAction(e, 'bookmark', book)}
                              >
                                <Bookmark size={14} />
                                <span>Manage Bookmark</span>
                              </button>
                              <button
                                className="action-menu-item"
                                onClick={(e) => handleMenuAction(e, 'notes', book)}
                              >
                                <FileText size={14} />
                                <span>View Notes</span>
                              </button>
                              <div className="action-menu-divider" />
                              <button
                                className="action-menu-item text-danger"
                                onClick={(e) => handleMenuAction(e, 'remove', book)}
                              >
                                <Trash2 size={14} />
                                <span>Remove from Library</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <h3 className="library-card-title" title={book.title}>
                      {book.title}
                    </h3>

                    {/* Progress block */}
                    <div className="library-card-progress">
                      <div className="card-progress-labels">
                        <span className="card-pages-text">
                          <strong>{book.currentPage}</strong> / {book.totalPages} pages
                        </span>
                        <span className="card-percent-text">{progress}%</span>
                      </div>
                      <div className="card-progress-track">
                        <div
                          className="card-progress-bar"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Footer Row: Last read info & primary action button */}
                    <div className="library-card-footer">
                      <div className="card-last-opened">
                        <Clock size={12} />
                        <span>{book.lastOpened}</span>
                      </div>

                      <button
                        className="card-read-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenBook(book);
                        }}
                      >
                        <span>{hasStarted ? 'Continue' : 'Start Reading'}</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* State 4: List View */
          <div className="library-list-layout">
            <div className="list-table-header">
              <span className="col-book">Volume</span>
              <span className="col-category">Category</span>
              <span className="col-progress">Reading Progress</span>
              <span className="col-last-read">Last Opened</span>
              <span className="col-actions">Actions</span>
            </div>

            <div className="list-items-container">
              {filteredBooks.map((book) => {
                const progress = calculateProgress(book.currentPage, book.totalPages);
                const isDropdownOpen = openDropdownId === book.id;
                const hasStarted = book.currentPage > 0;

                return (
                  <div
                    key={book.id}
                    className="library-list-row"
                    onClick={() => onOpenBook(book)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenBook(book);
                      }
                    }}
                  >
                    {/* Thumbnail and Title */}
                    <div className="col-book list-book-identity">
                      <div className="list-cover-thumb">
                        <BookCover
                          title={book.title}
                          theme={book.coverTheme}
                          coverUrl={book.coverUrl || book.coverImage || book.coverTheme?.coverUrl || book.coverTheme?.coverImage}
                          size="small"
                        />
                      </div>
                      <div className="list-title-box">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="list-book-title">{book.title}</span>
                          {book.isUserImported ? (
                            <span className="badge-user-imported">Personal PDF</span>
                          ) : (
                            <span className="badge-sample-volume">Sample</span>
                          )}
                        </div>
                        <span className="list-book-author">
                          {book.author || 'Personal Document'} • {book.format} ({book.totalPages} pages)
                        </span>
                      </div>
                    </div>

                    {/* Category */}
                    <div className="col-category">
                      <span className="list-category-badge">{book.category}</span>
                    </div>

                    {/* Progress Track & Details */}
                    <div className="col-progress list-progress-col">
                      <div className="list-progress-top">
                        <span className="list-pages-text">
                          {book.currentPage} / {book.totalPages} pages
                        </span>
                        <span className="list-pct-text">{progress}%</span>
                      </div>
                      <div className="list-progress-track">
                        <div
                          className="list-progress-bar"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Last Read */}
                    <div className="col-last-read list-time-col">
                      <Clock size={13} className="text-muted" />
                      <span>{book.lastOpened}</span>
                    </div>

                    {/* Action buttons & 3-dot menu */}
                    <div className="col-actions list-actions-col" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => onOpenBook(book)}
                      >
                        <span>{hasStarted ? 'Continue' : 'Start'}</span>
                        <ArrowRight size={13} />
                      </button>

                      <div className="card-menu-relative">
                        <button
                          className="card-more-btn"
                          onClick={(e) => handleToggleMenu(e, book.id)}
                          aria-label={`Actions for ${book.title}`}
                          aria-expanded={isDropdownOpen}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {isDropdownOpen && (
                          <div className="book-action-dropdown">
                            <button
                              className="action-menu-item"
                              onClick={(e) => handleMenuAction(e, 'rename', book)}
                            >
                              <Edit2 size={14} />
                              <span>Rename Book</span>
                            </button>
                            <button
                              className="action-menu-item"
                              onClick={(e) => handleMenuAction(e, 'category', book)}
                            >
                              <Tag size={14} />
                              <span>Change Category</span>
                            </button>
                            <button
                              className="action-menu-item"
                              onClick={(e) => handleMenuAction(e, 'details', book)}
                            >
                              <Info size={14} />
                              <span>View Book Details</span>
                            </button>
                            <button
                              className="action-menu-item"
                              onClick={(e) => handleMenuAction(e, 'bookmark', book)}
                            >
                              <Bookmark size={14} />
                              <span>Manage Bookmark</span>
                            </button>
                            <button
                              className="action-menu-item"
                              onClick={(e) => handleMenuAction(e, 'notes', book)}
                            >
                              <FileText size={14} />
                              <span>View Notes</span>
                            </button>
                            <div className="action-menu-divider" />
                            <button
                              className="action-menu-item text-danger"
                              onClick={(e) => handleMenuAction(e, 'remove', book)}
                            >
                              <Trash2 size={14} />
                              <span>Remove from Library</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Library-Wide Indexing Management Drawer */}
      <LibraryIndexingDrawer
        isOpen={isIndexingDrawerOpen}
        onClose={() => setIsIndexingDrawerOpen(false)}
      />
    </div>
  );
}
