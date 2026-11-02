/**
 * ReaderToolbar.jsx
 * Compact top toolbar for the Aks Reading Room.
 * Secondary actions collapse into a "more" menu at ≤768px.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Search,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  BookMarked,
  Loader2,
  StickyNote,
  BookOpen,
  FileText,
  AlignJustify,
  Maximize,
  Minimize,
  Minus,
  Plus,
  MoreHorizontal,
  Palette,
  Image as ImageIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

const MODES = [
  { id: 'book', label: 'Book', Icon: BookOpen, title: 'Physical Book Mode — two-page spread' },
  { id: 'pdf', label: 'PDF', Icon: FileText, title: 'PDF Mode — original layout with zoom' },
  { id: 'focus', label: 'Focus', Icon: AlignJustify, title: 'Focus Mode — comfortable reading layout' },
];

export default function ReaderToolbar({
  book,
  currentPage,
  totalPages,
  mode,
  isBookmarked,
  isFullscreen,
  scale,
  notesOpen,
  searchOpen,
  isSaved = false,
  isSaving = false,
  onSaveToLibrary,
  onOpenChangeCover,
  onBack,
  onPageChange,
  onPrev,
  onNext,
  onModeChange,
  onToggleBookmark,
  onToggleNotes,
  onToggleSearch,
  onToggleFullscreen,
  onScaleChange,
  onOpenBookmarkHistory,
  pageTurnSound = true,
  onTogglePageTurnSound,
  isBookmarkDisabled = false,
}) {
  const [pageInputVal, setPageInputVal] = useState(String(currentPage));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  // Keep input in sync when currentPage changes via arrow clicks or turns
  useEffect(() => {
    if (mode === 'book' && typeof window !== 'undefined' && window.innerWidth > 768) {
      if (currentPage <= 1) {
        setPageInputVal('1');
      } else {
        const left = currentPage % 2 === 0 ? currentPage : currentPage - 1;
        const right = left + 1 <= totalPages ? left + 1 : null;
        setPageInputVal(right ? `${left}–${right}` : `${left}`);
      }
    } else {
      setPageInputVal(String(currentPage));
    }
  }, [currentPage, mode, totalPages]);

  // Close "more" menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  const commitPageInput = () => {
    const clean = pageInputVal.replace(/[–—]/g, '-').split('-')[0].trim();
    const n = parseInt(clean, 10);
    if (!isNaN(n)) {
      onPageChange(n);
    } else {
      setPageInputVal(String(currentPage));
    }
  };

  const handleInputKey = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
      commitPageInput();
    } else if (e.key === 'Escape') {
      setPageInputVal(String(currentPage));
      e.target.blur();
    }
  };

  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  return (
    <header className="rdr-toolbar" role="toolbar" aria-label="Reading controls">
      {/* ── Left group: back + title ────────────────────────────────────────── */}
      <div className="rdr-tb-group rdr-tb-left">
        <button
          className="rdr-tb-btn rdr-back-btn"
          onClick={onBack}
          title="Back to previous page"
          aria-label="Back to previous page"
        >
          <ArrowLeft size={16} />
          <span className="rdr-tb-label">Back</span>
        </button>

        <div className="rdr-divider" aria-hidden="true" />

        <div className="rdr-title-block">
          <span className="rdr-book-title" title={book?.title}>
            {book?.title || 'Untitled Document'}
          </span>
          <span className="rdr-progress-chip" aria-label={`${progress}% read`}>
            {progress}%
          </span>
        </div>
      </div>

      {/* ── Center group: page nav + mode selector ──────────────────────────── */}
      <div className="rdr-tb-group rdr-tb-center">
        {/* Page navigation */}
        <div className="rdr-page-nav" role="navigation" aria-label="Page navigation">
          <button
            className="rdr-tb-btn rdr-nav-arrow"
            onClick={onPrev || (() => onPageChange(currentPage - 1))}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            title="Turn to previous page (←)"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="rdr-compact-page-box" title="Current page / Total pages (click to jump)">
            <input
              type="text"
              className="rdr-compact-page-input"
              value={pageInputVal}
              aria-label={`Page ${currentPage} of ${totalPages}`}
              onChange={(e) => setPageInputVal(e.target.value)}
              onBlur={commitPageInput}
              onKeyDown={handleInputKey}
            />
            <span className="rdr-compact-page-divider">/</span>
            <span className="rdr-compact-page-total">{totalPages}</span>
          </div>

          <button
            className="rdr-tb-btn rdr-nav-arrow"
            onClick={onNext || (() => onPageChange(currentPage + 1))}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
            title="Turn to next page (→)"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="rdr-divider" aria-hidden="true" />

        {/* Mode selector */}
        <div className="rdr-mode-selector" role="group" aria-label="Reading mode">
          {MODES.map(({ id, label, Icon, title }) => (
            <button
              key={id}
              className={`rdr-mode-btn ${mode === id ? 'rdr-mode-btn--active' : ''}`}
              onClick={() => onModeChange(id)}
              title={title}
              aria-pressed={mode === id}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right group: tools ──────────────────────────────────────────────── */}
      <div className="rdr-tb-group rdr-tb-right">
        {/* Zoom (PDF mode only) */}
        {mode === 'pdf' && (
          <div className="rdr-zoom-controls" aria-label="Zoom controls">
            <button
              className="rdr-tb-btn rdr-zoom-btn"
              onClick={() => onScaleChange(Math.max(0.5, scale - 0.25))}
              disabled={scale <= 0.5}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <Minus size={14} />
            </button>
            <span className="rdr-zoom-label" aria-live="polite">{Math.round(scale * 100)}%</span>
            <button
              className="rdr-tb-btn rdr-zoom-btn"
              onClick={() => onScaleChange(Math.min(3, scale + 0.25))}
              disabled={scale >= 3}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <Plus size={14} />
            </button>
            <div className="rdr-divider" aria-hidden="true" />
          </div>
        )}

        {/* Save to Library / In Library */}
        <button
          className={`rdr-tb-btn rdr-save-lib-btn ${isSaved ? 'rdr-save-lib-btn--saved' : ''} ${isSaving ? 'rdr-save-lib-btn--saving' : ''}`}
          onClick={onSaveToLibrary}
          disabled={isSaved || isSaving}
          title={
            isSaving
              ? 'Saving to library…'
              : isSaved
              ? 'Saved in your library'
              : 'Save this book to your library'
          }
          aria-label={
            isSaving
              ? 'Saving to library'
              : isSaved
              ? 'In Library'
              : 'Save to Library'
          }
        >
          {isSaving ? (
            <Loader2 size={16} className="rdr-spin" />
          ) : isSaved ? (
            <BookmarkCheck size={16} />
          ) : (
            <BookmarkPlus size={16} />
          )}
          <span className="rdr-tb-label rdr-label-hide-sm">
            {isSaving ? 'Saving…' : isSaved ? 'In Library' : 'Save to Library'}
          </span>
        </button>

        {/* Change Book Cover */}
        <button
          className="rdr-tb-btn rdr-cover-btn"
          onClick={onOpenChangeCover}
          title="Change Book Cover"
          aria-label="Change Book Cover"
        >
          <ImageIcon size={16} />
          <span className="rdr-tb-label rdr-label-hide-sm">Cover</span>
        </button>

        <div className="rdr-divider rdr-divider-hide-sm" aria-hidden="true" />

        {/* Search */}
        <button
          className={`rdr-tb-btn ${searchOpen ? 'rdr-tb-btn--active' : ''}`}
          onClick={onToggleSearch}
          title="Search document (Ctrl+F)"
          aria-label="Search document"
          aria-pressed={searchOpen}
        >
          <Search size={16} />
          <span className="rdr-tb-label rdr-label-hide-sm">Search</span>
        </button>

        {/* Bookmark */}
        <button
          className={`rdr-tb-btn ${isBookmarked ? 'rdr-tb-btn--bookmarked' : ''}`}
          onClick={onToggleBookmark}
          disabled={isBookmarkDisabled}
          title={isBookmarked ? 'Remove bookmark from this page' : 'Bookmark this page'}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark page'}
          aria-pressed={isBookmarked}
        >
          {isBookmarked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          <span className="rdr-tb-label rdr-label-hide-sm">Mark</span>
        </button>

        {/* Notes */}
        <button
          className={`rdr-tb-btn ${notesOpen ? 'rdr-tb-btn--active' : ''}`}
          onClick={onToggleNotes}
          title="My Notes panel"
          aria-label="Toggle notes panel"
          aria-pressed={notesOpen}
        >
          <StickyNote size={16} />
          <span className="rdr-tb-label rdr-label-hide-sm">Notes</span>
        </button>

        <div className="rdr-divider rdr-divider-hide-sm" aria-hidden="true" />

        {/* Fullscreen */}
        <button
          className="rdr-tb-btn"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen (F)'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>

        {/* More menu (secondary actions on mobile) */}
        <div className="rdr-more-container" ref={moreRef}>
          <button
            className={`rdr-tb-btn rdr-more-btn ${moreOpen ? 'rdr-tb-btn--active' : ''}`}
            onClick={() => setMoreOpen((v) => !v)}
            title="More options"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal size={16} />
          </button>

          {moreOpen && (
            <div className="rdr-more-menu" role="menu" aria-label="More reader options">
              <button
                className={`rdr-more-item ${isSaved ? 'rdr-more-item--saved' : ''}`}
                role="menuitem"
                onClick={() => {
                  if (!isSaved && !isSaving && onSaveToLibrary) {
                    onSaveToLibrary();
                  }
                  setMoreOpen(false);
                }}
                disabled={isSaved || isSaving}
              >
                {isSaving ? (
                  <Loader2 size={15} className="rdr-spin" />
                ) : isSaved ? (
                  <BookmarkCheck size={15} />
                ) : (
                  <BookmarkPlus size={15} />
                )}
                <span>{isSaving ? 'Saving to library…' : isSaved ? 'In Library' : 'Save to Library'}</span>
              </button>
              <button
                className="rdr-more-item"
                role="menuitem"
                onClick={() => {
                  onOpenChangeCover?.();
                  setMoreOpen(false);
                }}
              >
                <ImageIcon size={15} />
                <span>Change Book Cover</span>
              </button>
              <div className="rdr-more-divider" />
              <button
                className="rdr-more-item"
                role="menuitem"
                disabled={isBookmarkDisabled}
                onClick={() => {
                  if (isBookmarkDisabled) return;
                  onToggleBookmark();
                  setMoreOpen(false);
                }}
              >
                {isBookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                <span>{isBookmarked ? 'Remove bookmark' : 'Bookmark page'}</span>
              </button>
              <button
                className="rdr-more-item"
                role="menuitem"
                data-testid="rdr-more-bookmark-history"
                onClick={() => {
                  onOpenBookmarkHistory?.();
                  setMoreOpen(false);
                }}
              >
                <BookMarked size={15} />
                <span>Bookmark History</span>
              </button>
              <button
                className="rdr-more-item"
                role="menuitem"
                onClick={() => { onToggleSearch(); setMoreOpen(false); }}
              >
                <Search size={15} />
                <span>Search document</span>
              </button>
              <button
                className="rdr-more-item"
                role="menuitem"
                onClick={() => { onToggleNotes(); setMoreOpen(false); }}
              >
                <StickyNote size={15} />
                <span>My Notes</span>
              </button>
              <div className="rdr-more-divider" />
              <button
                className="rdr-more-item"
                role="menuitem"
                data-testid="rdr-more-page-turn-sound"
                aria-label={`Page turn sound is ${pageTurnSound ? 'enabled' : 'disabled'}. Click to toggle.`}
                onClick={() => {
                  onTogglePageTurnSound?.();
                }}
              >
                {pageTurnSound ? <Volume2 size={15} /> : <VolumeX size={15} />}
                <span>Page Turn Sound: {pageTurnSound ? 'On' : 'Off'}</span>
              </button>
              <div className="rdr-more-divider" />
              <button
                className="rdr-more-item"
                role="menuitem"
                onClick={() => { onToggleFullscreen(); setMoreOpen(false); }}
              >
                {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                <span>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
              </button>
              {mode === 'pdf' && (
                <>
                  <div className="rdr-more-divider" />
                  <div className="rdr-more-zoom-row">
                    <button onClick={() => onScaleChange(Math.max(0.5, scale - 0.25))} disabled={scale <= 0.5} aria-label="Zoom out"><Minus size={14} /></button>
                    <span>{Math.round(scale * 100)}%</span>
                    <button onClick={() => onScaleChange(Math.min(3, scale + 0.25))} disabled={scale >= 3} aria-label="Zoom in"><Plus size={14} /></button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Progress bar (full-width stripe below toolbar) ───────────────────── */}
      <div
        className="rdr-progress-stripe"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Reading progress: ${progress}%`}
      >
        <div className="rdr-progress-stripe-fill" style={{ width: `${progress}%` }} />
      </div>
    </header>
  );
}
