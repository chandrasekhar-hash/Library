import React, { useState, useRef, useMemo } from 'react';
import {
  UploadCloud,
  FileCheck,
  AlertCircle,
  BookOpen,
  BookmarkPlus,
  Loader2,
  FileText,
  RotateCcw,
  X,
  ChevronRight,
  Home,
  Clock,
  Layers,
  Bookmark,
  CheckCircle2,
  ArrowRight,
  Library,
  FilePlus2,
} from 'lucide-react';
import BookCover from '../components/BookCover';
import { parsePdfMetadata, computeFileHash, findDuplicateBook } from '../services/pdfParser';
import { renderPageThumbnail } from '../services/pdfService';
import { LIBRARY_CATEGORIES, calculateProgress } from '../data/mockBooks';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export default function ImportPage({
  books = [],
  onReadNow,
  onSaveToLibrary,
  onNavigateTo,
  onOpenBook,
}) {
  // ── Upload + parse state ────────────────────────────────────────────────────
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [saveSuccessId, setSaveSuccessId] = useState(null);

  // Parsed + editable metadata
  const [bookTitle, setBookTitle] = useState('');
  const [bookCategory, setBookCategory] = useState('General');
  const [pageCount, setPageCount] = useState(1);
  const [fileDetails, setFileDetails] = useState(null);
  const [duplicateMatch, setDuplicateMatch] = useState(null);
  const [computedHash, setComputedHash] = useState(null);
  const [coverThumbnail, setCoverThumbnail] = useState(null);

  const fileInputRef = useRef(null);

  // Recently added books from the real library (user-imported, newest first)
  const recentlyAdded = useMemo(() => {
    return [...books]
      .sort((a, b) => (b.lastOpenedTimestamp || 0) - (a.lastOpenedTimestamp || 0))
      .slice(0, 5);
  }, [books]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const resetState = () => {
    setSelectedFile(null);
    setIsParsing(false);
    setIsSaving(false);
    setErrorMessage(null);
    setBookTitle('');
    setPageCount(1);
    setFileDetails(null);
    setSaveSuccessId(null);
    setDuplicateMatch(null);
    setComputedHash(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  // ── File validation + parsing ────────────────────────────────────────────────
  const handleFileSelected = async (file) => {
    setErrorMessage(null);
    setSaveSuccessId(null);

    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      setErrorMessage(
        'Only PDF documents are supported. Please choose a .pdf file.'
      );
      return;
    }

    if (file.size === 0) {
      setErrorMessage(
        'The selected file is empty (0 bytes). Please choose a valid PDF document.'
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 100 MB.`
      );
      return;
    }

    const formattedSize =
      file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;

    setSelectedFile(file);
    setIsParsing(true);
    setFileDetails({ filename: file.name, size: formattedSize, rawBytes: file.size });

    const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    setBookTitle(cleanName);

    try {
      setCoverThumbnail(null);
      const [parsed, hash, thumb] = await Promise.all([
        parsePdfMetadata(file),
        computeFileHash(file),
        renderPageThumbnail(file, 1).catch((err) => {
          console.warn('[ImportPage] Thumbnail generation error:', err);
          return null;
        }),
      ]);
      setPageCount(parsed.pageCount || 1);
      if (parsed.title && parsed.title.trim()) {
        setBookTitle(parsed.title.trim());
      }
      setComputedHash(hash);
      if (thumb) {
        setCoverThumbnail(thumb);
      }

      const duplicate = await findDuplicateBook(file, books, parsed.pageCount);
      if (duplicate) {
        setDuplicateMatch(duplicate);
      }
    } catch (err) {
      console.warn('PDF metadata parsing error:', err);
      setPageCount(1);
    } finally {
      setIsParsing(false);
    }
  };

  // ── Build book object ────────────────────────────────────────────────────────
  const createBookObject = () => {
    const initials =
      bookTitle
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('') || 'PDF';

    return {
      id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: bookTitle.trim() || 'Untitled Document',
      filename: fileDetails?.filename || selectedFile.name,
      fileHash: computedHash,
      author: 'Personal Document',
      totalPages: pageCount,
      currentPage: 0,
      format: 'PDF',
      category: bookCategory,
      status: 'not-started',
      lastOpened: 'Just imported',
      lastOpenedTimestamp: Date.now(),
      dateAdded: new Date().toISOString(),
      fileSize: fileDetails?.size || 'Unknown',
      rawBytes: fileDetails?.rawBytes || selectedFile.size,
      mimeType: selectedFile.type || 'application/pdf',
      isUserImported: true,
      blob: selectedFile,
      coverTheme: {
        primary: '#1D2A44',
        secondary: '#0E1726',
        accent: '#E7C18A',
        pattern: 'mesh-geo',
        initials,
        coverUrl: coverThumbnail?.dataUrl || null,
        coverImage: coverThumbnail?.dataUrl || null,
      },
      coverImage: coverThumbnail?.dataUrl || null,
      defaultCoverImage: coverThumbnail?.dataUrl || null,
      coverBlob: coverThumbnail?.blob || null,
      defaultCoverBlob: coverThumbnail?.blob || null,
      notesCount: 0,
      bookmarksCount: 0,
      highlightsCount: 0,
      highlights: [],
      bookmarks: [],
      notes: [],
      description: `Locally imported PDF: ${selectedFile.name} (${fileDetails?.size}).`,
    };
  };

  // ── Action: Read Now ─────────────────────────────────────────────────────────
  const handleReadNow = () => {
    if (!selectedFile) return;
    const tempBook = createBookObject();
    if (onReadNow) onReadNow(tempBook);
  };

  // ── Action: Save to My Library ───────────────────────────────────────────────
  const handleSaveToLibrary = async () => {
    if (!selectedFile || !bookTitle.trim()) return;
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const book = createBookObject();
      const saved = await onSaveToLibrary(book);
      setSaveSuccessId(saved?.id || book.id);
      setSelectedFile(null);
      setFileDetails(null);
      setBookTitle('');
      setPageCount(1);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('Save error:', err);
      setErrorMessage(
        'Failed to save to IndexedDB. You may be in private browsing mode or storage quota was exceeded.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="import-page-container">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <header className="import-page-header">
        {/* Breadcrumb */}
        <nav className="import-breadcrumb" aria-label="Page breadcrumb">
          <button
            className="breadcrumb-link"
            onClick={() => onNavigateTo && onNavigateTo('home')}
          >
            <Home size={13} />
            <span>Home</span>
          </button>
          <ChevronRight size={13} className="breadcrumb-sep" />
          <span className="breadcrumb-current">Import Book</span>
        </nav>

        <div className="import-header-eyebrow">
          <FilePlus2 size={13} />
          <span>YOUR PERSONAL LIBRARY</span>
        </div>

        <h2 className="import-page-title">Bring a book into your sanctuary.</h2>
        <p className="import-page-description">
          Import a PDF, start reading immediately, or save it to your personal
          library for later.
        </p>
      </header>

      {/* ── Main Upload Panel ────────────────────────────────────────────────── */}
      <section className="import-main-panel" aria-label="PDF upload area">
        {/* Hidden real file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          onChange={handleInputChange}
          aria-label="Select PDF file from device"
          id="import-page-file-input"
        />

        {/* ── Error Banner ────────────────────────────────────────────────── */}
        {errorMessage && (
          <div className="ip-error-banner" role="alert" aria-live="assertive">
            <AlertCircle size={17} className="ip-error-icon" />
            <div className="ip-error-text">
              <span>{errorMessage}</span>
              <button
                className="ip-retry-btn"
                onClick={() => {
                  setErrorMessage(null);
                  fileInputRef.current?.click();
                }}
              >
                <RotateCcw size={12} />
                <span>Try another file</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Save Success Banner ─────────────────────────────────────────── */}
        {saveSuccessId && !selectedFile && (
          <div className="ip-success-banner" role="status" aria-live="polite">
            <CheckCircle2 size={17} className="ip-success-icon" />
            <span>
              <strong>Saved to My Library.</strong> Your document is now
              permanently stored and available across sessions.
            </span>
            <button
              className="ip-goto-library-btn"
              onClick={() => onNavigateTo && onNavigateTo('library')}
            >
              <Library size={14} />
              <span>Go to My Library</span>
            </button>
          </div>
        )}

        {!selectedFile ? (
          /* ── Empty dropzone ──────────────────────────────────────────────── */
          <div
            className={`ip-dropzone ${dragActive ? 'ip-dropzone--drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Click to select a PDF file, or drag and drop here"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <div className="ip-dropzone-icon-ring">
              <UploadCloud size={42} className="ip-upload-icon" />
            </div>
            <h3 className="ip-dropzone-headline">Your next chapter starts here.</h3>
            <p className="ip-dropzone-body">
              Drag and drop your PDF here, or browse your device.
            </p>

            <button
              className="ip-choose-btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              type="button"
            >
              <UploadCloud size={16} />
              <span>Choose PDF</span>
            </button>

            <div className="ip-dropzone-hints">
              <span className="ip-hint-pill">
                <FileText size={12} />
                PDF documents only
              </span>
              <span className="ip-hint-pill">
                <Layers size={12} />
                Up to 100 MB
              </span>
            </div>
          </div>
        ) : (
          /* ── Selected PDF review card ────────────────────────────────────── */
          <div className="ip-review-panel">
            {/* Cover + file info */}
            <div className="ip-review-top">
              <div className="ip-cover-preview">
                <BookCover
                  title={bookTitle || 'Untitled'}
                  theme={{
                    primary: '#1D2A44',
                    secondary: '#0E1726',
                    accent: '#E7C18A',
                    pattern: 'mesh-geo',
                    initials:
                      bookTitle
                        .split(' ')
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() || '')
                        .join('') || 'PDF',
                  }}
                  coverUrl={coverThumbnail?.dataUrl || null}
                  size="medium"
                />
              </div>

              <div className="ip-review-details">
                <div className="ip-file-info-card">
                  <FileCheck size={20} className="ip-file-check-icon" />
                  <div className="ip-file-meta">
                    <span
                      className="ip-filename"
                      title={fileDetails?.filename}
                    >
                      {fileDetails?.filename}
                    </span>
                    <div className="ip-meta-badges">
                      <span className="ip-badge ip-badge--pdf">PDF</span>
                      <span className="ip-badge ip-badge--size">
                        {fileDetails?.size}
                      </span>
                      {isParsing ? (
                        <span className="ip-badge ip-badge--parsing">
                          <Loader2 size={11} className="ip-spin" />
                          Detecting pages…
                        </span>
                      ) : (
                        <span className="ip-badge ip-badge--pages">
                          <strong>{pageCount}</strong>{' '}
                          {pageCount === 1 ? 'page' : 'pages'}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    className="ip-change-file-btn btn-secondary btn-sm"
                    onClick={() => {
                      resetState();
                      setTimeout(() => fileInputRef.current?.click(), 80);
                    }}
                    title="Select a different PDF"
                  >
                    <X size={13} />
                    Change
                  </button>
                </div>

                {/* Editable metadata form */}
                <div className="ip-metadata-form">
                  <div className="ip-form-field">
                    <label
                      className="ip-field-label"
                      htmlFor="ip-title-input"
                    >
                      Volume Title
                    </label>
                    <input
                      id="ip-title-input"
                      type="text"
                      className="ip-text-input"
                      value={bookTitle}
                      onChange={(e) => setBookTitle(e.target.value)}
                      placeholder="Enter book title"
                      required
                      aria-required="true"
                    />
                  </div>

                  <div className="ip-form-field">
                    <label
                      className="ip-field-label"
                      htmlFor="ip-category-select"
                    >
                      Category Shelf
                    </label>
                    <select
                      id="ip-category-select"
                      className="ip-text-input ip-select-input"
                      value={bookCategory}
                      onChange={(e) => setBookCategory(e.target.value)}
                    >
                      {LIBRARY_CATEGORIES.filter((c) => c !== 'All').map(
                        (cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        )
                      )}
                      <option value="Literature">Literature</option>
                      <option value="Science">Science</option>
                      <option value="General Reading">General Reading</option>
                    </select>
                  </div>
                </div>

                {/* Storage note */}
                <div className="ip-storage-note">
                  <FileText size={14} className="ip-note-icon" />
                  <span>
                    <strong>Save to My Library</strong> stores this PDF in your
                    browser's IndexedDB — available after page refresh.{' '}
                    <strong>Read Now</strong> opens it without saving.
                  </span>
                </div>

                {/* Duplicate volume warning */}
                {duplicateMatch && (
                  <div className="ip-duplicate-banner" role="alert">
                    <div className="ip-duplicate-icon">
                      <AlertCircle size={22} />
                    </div>
                    <div className="ip-duplicate-content">
                      <div className="ip-duplicate-header">
                        <h4 className="ip-duplicate-title">Existing Sanctuary Volume Detected</h4>
                        <span className="ip-duplicate-badge">
                          {duplicateMatch.matchType === 'content' ? 'Exact Content Match' : 'Matching Volume'}
                        </span>
                      </div>
                      <p className="ip-duplicate-desc">
                        This document appears to already exist in your sanctuary library as{' '}
                        <strong>"{duplicateMatch.book.title}"</strong> ({duplicateMatch.book.totalPages} pages, currently on page {duplicateMatch.book.currentPage || 1}, shelf: {duplicateMatch.book.category}).
                      </p>
                      <div className="ip-duplicate-actions">
                        {onOpenBook && (
                          <button
                            type="button"
                            className="btn-primary ip-duplicate-btn-open"
                            onClick={() => onOpenBook(duplicateMatch.book)}
                          >
                            <BookOpen size={15} />
                            <span>Open Existing Book</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary ip-duplicate-btn-copy"
                          onClick={() => {
                            setBookTitle((prev) => `${prev} (Copy)`);
                            setDuplicateMatch(null);
                          }}
                        >
                          <BookmarkPlus size={15} />
                          <span>Import as New Copy</span>
                        </button>
                        <button
                          type="button"
                          className="btn-ghost ip-duplicate-btn-cancel"
                          onClick={resetState}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="ip-action-row">
              <button
                className="ip-cancel-btn"
                onClick={resetState}
                type="button"
                title="Cancel and discard this selection"
              >
                <X size={15} />
                <span>Cancel</span>
              </button>

              <div className="ip-primary-actions">
                <button
                  type="button"
                  className="btn-secondary ip-read-now-btn"
                  onClick={handleReadNow}
                  disabled={isParsing || isSaving}
                  title="Open immediately in reader preview — does not save to library"
                >
                  <BookOpen size={16} />
                  <span>Read Now</span>
                </button>

                <button
                  type="button"
                  className="btn-primary ip-save-btn"
                  onClick={handleSaveToLibrary}
                  disabled={isParsing || isSaving || !bookTitle.trim()}
                  title="Save PDF and metadata permanently to IndexedDB"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={16} className="ip-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus size={16} />
                      <span>Save to My Library</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── "Your reading, your way" feature cards ───────────────────────────── */}
      <section className="ip-feature-section" aria-label="Import options overview">
        <h3 className="ip-section-label">Your reading, your way.</h3>
        <div className="ip-feature-grid">
          <div className="ip-feature-card">
            <div className="ip-feature-icon-ring ip-feature-icon-ring--gold">
              <BookOpen size={18} />
            </div>
            <div className="ip-feature-text">
              <strong>Read immediately</strong>
              <span>
                Open any PDF directly without committing it to your permanent
                library.
              </span>
            </div>
          </div>

          <div className="ip-feature-card">
            <div className="ip-feature-icon-ring ip-feature-icon-ring--teal">
              <Bookmark size={18} />
            </div>
            <div className="ip-feature-text">
              <strong>Keep it in your library</strong>
              <span>
                Save the document locally so it remains available every time
                you reopen Aks.
              </span>
            </div>
          </div>

          <div className="ip-feature-card">
            <div className="ip-feature-icon-ring ip-feature-icon-ring--slate">
              <Clock size={18} />
            </div>
            <div className="ip-feature-text">
              <strong>Continue anytime</strong>
              <span>
                Your last reading position is saved and restored when you
                reopen a book in My Library.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recently Added section ───────────────────────────────────────────── */}
      <section className="ip-recent-section" aria-label="Recently added books">
        <div className="ip-recent-header">
          <h3 className="ip-section-label">Recently Added</h3>
          {recentlyAdded.length > 0 && (
            <button
              className="ip-view-library-btn"
              onClick={() => onNavigateTo && onNavigateTo('library')}
            >
              <span>View All</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>

        {recentlyAdded.length === 0 ? (
          <div className="ip-empty-recent">
            <div className="ip-empty-icon-ring">
              <Library size={26} className="ip-empty-icon" />
            </div>
            <p className="ip-empty-title">Your library is waiting.</p>
            <p className="ip-empty-body">
              Import your first PDF above and it will appear here.
            </p>
          </div>
        ) : (
          <ul className="ip-recent-list" aria-label="Recently added books">
            {recentlyAdded.map((book) => {
              const progress = calculateProgress(
                book.currentPage,
                book.totalPages
              );
              return (
                <li key={book.id} className="ip-recent-item">
                  <div className="ip-recent-cover">
                    <BookCover
                      title={book.title}
                      theme={book.coverTheme}
                      coverUrl={book.coverUrl || book.coverImage || book.coverTheme?.coverUrl || book.coverTheme?.coverImage}
                      size="small"
                    />
                  </div>
                  <div className="ip-recent-info">
                    <span className="ip-recent-title">{book.title}</span>
                    <div className="ip-recent-meta">
                      <span className="ip-badge ip-badge--pdf">PDF</span>
                      {book.totalPages && (
                        <span className="ip-recent-pages">
                          {book.totalPages} pages
                        </span>
                      )}
                      {book.isUserImported && (
                        <span className="badge-user-imported">Personal PDF</span>
                      )}
                    </div>
                    {book.dateAdded && (
                      <span className="ip-recent-date">
                        Added {formatDate(book.dateAdded)}
                      </span>
                    )}
                    {progress > 0 && (
                      <div className="ip-recent-progress-row">
                        <div className="ip-recent-progress-bar">
                          <div
                            className="ip-recent-progress-fill"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="ip-recent-progress-pct">
                          {progress}%
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    className="ip-open-book-btn btn-secondary"
                    onClick={() => onOpenBook && onOpenBook(book)}
                    title={`Open ${book.title}`}
                  >
                    <BookOpen size={14} />
                    <span>Open</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
