import React, { useState, useRef } from 'react';
import {
  X,
  UploadCloud,
  FileCheck,
  AlertCircle,
  BookOpen,
  BookmarkPlus,
  Loader2,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { parsePdfMetadata, computeFileHash, findDuplicateBook } from '../services/pdfParser';
import { renderPageThumbnail } from '../services/pdfService';
import { LIBRARY_CATEGORIES } from '../data/mockBooks';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB limit

export default function ImportModal({
  isOpen,
  onClose,
  onReadNow,
  onSaveToLibrary,
  books = [],
  onOpenBook,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [duplicateMatch, setDuplicateMatch] = useState(null);
  const [computedHash, setComputedHash] = useState(null);
  const [coverThumbnail, setCoverThumbnail] = useState(null);

  // Editable parsed metadata
  const [bookTitle, setBookTitle] = useState('');
  const [bookCategory, setBookCategory] = useState('General');
  const [pageCount, setPageCount] = useState(1);
  const [fileDetails, setFileDetails] = useState(null);

  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const resetState = () => {
    setSelectedFile(null);
    setIsParsing(false);
    setIsSaving(false);
    setErrorMessage(null);
    setBookTitle('');
    setPageCount(1);
    setFileDetails(null);
    setDuplicateMatch(null);
    setComputedHash(null);
    setCoverThumbnail(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Drag and drop event handlers
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

  // Validate and parse selected PDF
  const handleFileSelected = async (file) => {
    setErrorMessage(null);

    // 1. Validate MIME type or extension
    const isPdf =
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      setErrorMessage('The selected file is not a valid PDF document. Please choose a .pdf file.');
      return;
    }

    // 2. Validate non-empty file
    if (file.size === 0) {
      setErrorMessage('The selected PDF file is empty (0 bytes). Please choose a valid document.');
      return;
    }

    // 3. Validate maximum size limit
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). The maximum allowed size is 100 MB.`
      );
      return;
    }

    setSelectedFile(file);
    setIsParsing(true);

    const formattedSize =
      file.size < 1024 * 1024
        ? (file.size / 1024).toFixed(1) + ' KB'
        : (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    setFileDetails({
      filename: file.name,
      size: formattedSize,
      rawBytes: file.size,
    });

    // Default clean title from filename
    const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    setBookTitle(cleanName);

    try {
      setCoverThumbnail(null);
      const [parsed, hash, thumb] = await Promise.all([
        parsePdfMetadata(file),
        computeFileHash(file),
        renderPageThumbnail(file, 1).catch((err) => {
          console.warn('[ImportModal] Thumbnail generation error:', err);
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
      console.warn('PDF parsing error encountered:', err);
      // Fallback page count
      setPageCount(1);
    } finally {
      setIsParsing(false);
    }
  };

  // Generate book data object
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
      blob: selectedFile, // Store actual Blob
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
      description: `Locally imported PDF document: ${selectedFile.name} (${fileDetails?.size}).`,
    };
  };

  // Action 1: Read Now
  const handleReadNowClick = () => {
    if (!selectedFile) return;
    const tempBook = createBookObject();
    onReadNow(tempBook);
    handleClose();
  };

  // Action 2: Save to My Library
  const handleSaveToLibraryClick = async () => {
    if (!selectedFile) return;

    try {
      setIsSaving(true);
      setErrorMessage(null);
      const bookToSave = createBookObject();
      await onSaveToLibrary(bookToSave);
      handleClose();
    } catch (err) {
      console.error('Error saving book to library IndexedDB:', err);
      setErrorMessage(
        'Failed to save document to IndexedDB storage. You may be in private browsing mode or storage quota was exceeded.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose} role="dialog" aria-modal="true">
      <div className="import-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-header">
          <div className="import-header-title-row">
            <div className="import-icon-halo">
              <UploadCloud size={22} className="text-gold" />
            </div>
            <div>
              <h3 className="import-modal-heading">Import a Book</h3>
              <span className="import-modal-sub">Add a PDF document to your reading sanctuary</span>
            </div>
          </div>

          <button
            className="modal-close-icon-btn"
            onClick={handleClose}
            aria-label="Close import dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="import-modal-content">
          {/* Hidden real file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            onChange={handleInputChange}
            aria-hidden="true"
          />

          {/* Error Banner if any */}
          {errorMessage && (
            <div className="import-error-banner" role="alert">
              <AlertCircle size={18} className="text-danger flex-shrink-0" />
              <div className="error-text-col">
                <span className="error-msg">{errorMessage}</span>
                <button
                  className="retry-btn"
                  onClick={() => {
                    setErrorMessage(null);
                    fileInputRef.current?.click();
                  }}
                >
                  <RotateCcw size={12} />
                  <span>Try selecting another file</span>
                </button>
              </div>
            </div>
          )}

          {!selectedFile ? (
            /* Upload Dropzone Area */
            <div
              className={`import-dropzone ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <div className="dropzone-halo">
                <UploadCloud size={34} className="text-gold" />
              </div>
              <h4 className="dropzone-title">Click or drag & drop your PDF file here</h4>
              <p className="dropzone-subtitle">
                Supports PDF documents up to 100 MB. Extracts real page count automatically.
              </p>
              <span className="browse-files-pill">Browse Local Files</span>
            </div>
          ) : (
            /* Selected File Review & Actions Area */
            <div className="import-review-container">
              {/* File Info Card */}
              <div className="selected-pdf-card">
                <div className="pdf-card-icon-halo">
                  <FileCheck size={26} className="text-teal" />
                </div>
                <div className="pdf-card-details">
                  <span className="pdf-filename" title={fileDetails?.filename}>
                    {fileDetails?.filename}
                  </span>
                  <div className="pdf-meta-badges">
                    <span className="badge-teal">PDF Document</span>
                    <span className="badge-slate">{fileDetails?.size}</span>
                    {isParsing ? (
                      <span className="badge-parsing">
                        <Loader2 size={12} className="spin-icon" />
                        Detecting pages...
                      </span>
                    ) : (
                      <span className="badge-pages">
                        <strong>{pageCount}</strong> {pageCount === 1 ? 'page' : 'pages'} detected
                      </span>
                    )}
                  </div>
                </div>

                <button
                  className="btn-secondary btn-sm change-file-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Choose a different PDF file"
                >
                  Change File
                </button>
              </div>

              {/* Editable Metadata Form */}
              <div className="import-metadata-form">
                <div className="form-field">
                  <label className="field-label" htmlFor="import-title-input">
                    Volume Title
                  </label>
                  <input
                    id="import-title-input"
                    type="text"
                    className="action-text-input"
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    placeholder="Enter book title"
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="field-label" htmlFor="import-category-select">
                    Category Shelf
                  </label>
                  <select
                    id="import-category-select"
                    className="action-text-input action-select-input"
                    value={bookCategory}
                    onChange={(e) => setBookCategory(e.target.value)}
                  >
                    {LIBRARY_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value="General Reading">General Reading</option>
                  </select>
                </div>
              </div>

              {/* Informational Scope Note */}
              <div className="storage-info-callout">
                <FileText size={16} className="text-gold flex-shrink-0" />
                <span>
                  <strong>Storage Note:</strong> "Save to My Library" permanently stores the PDF
                  and metadata locally in your browser's <strong>IndexedDB</strong>. It will remain
                  available across reloads.
                </span>
              </div>

              {/* Duplicate volume warning */}
              {duplicateMatch && (
                <div className="ip-duplicate-banner" role="alert">
                  <div className="ip-duplicate-icon">
                    <AlertCircle size={20} />
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
                      <strong>"{duplicateMatch.book.title}"</strong> ({duplicateMatch.book.totalPages} pages, currently on page {duplicateMatch.book.currentPage || 1}).
                    </p>
                    <div className="ip-duplicate-actions">
                      {onOpenBook && (
                        <button
                          type="button"
                          className="btn-primary ip-duplicate-btn-open"
                          onClick={() => {
                            handleClose();
                            onOpenBook(duplicateMatch.book);
                          }}
                        >
                          <BookOpen size={14} />
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
                        <BookmarkPlus size={14} />
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

              {/* Distinct Action Buttons: 1. Read Now, 2. Save to My Library */}
              <div className="import-actions-row">
                <button
                  type="button"
                  className="btn-secondary read-now-btn"
                  onClick={handleReadNowClick}
                  disabled={isParsing || isSaving}
                  title="Open in reader preview immediately without saving yet"
                >
                  <BookOpen size={16} />
                  <span>Read Now</span>
                </button>

                <button
                  type="button"
                  className="btn-primary save-library-btn"
                  onClick={handleSaveToLibraryClick}
                  disabled={isParsing || isSaving || !bookTitle.trim()}
                  title="Save document and metadata to IndexedDB"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={16} className="spin-icon" />
                      <span>Saving to Library...</span>
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
          )}
        </div>
      </div>
    </div>
  );
}
