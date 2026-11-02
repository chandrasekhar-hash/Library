import React, { useState } from 'react';
import {
  X,
  Edit2,
  Tag,
  Info,
  Bookmark,
  FileText,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import BookCover from './BookCover';
import { calculateProgress, LIBRARY_CATEGORIES } from '../data/mockBooks';

/**
 * Modals for book-specific actions in My Library:
 * - Rename
 * - Change Category
 * - View Details
 * - Manage Bookmark
 * - View Notes
 * - Confirm Remove
 */
export default function BookActionModals({
  action, // { type: 'rename' | 'category' | 'details' | 'bookmark' | 'notes' | 'remove', book: BookObject }
  onClose,
  onRenameBook,
  onChangeCategory,
  onUpdateBookmark,
  onRemoveBook,
  onOpenReader,
}) {
  if (!action || !action.book) return null;

  const { type, book } = action;
  const progress = calculateProgress(book.currentPage, book.totalPages);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="book-action-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal-close-icon-btn"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        {type === 'rename' && (
          <RenameModalContent
            book={book}
            onClose={onClose}
            onSave={(newTitle) => {
              onRenameBook(book.id, newTitle);
              onClose();
            }}
          />
        )}

        {type === 'category' && (
          <ChangeCategoryModalContent
            book={book}
            onClose={onClose}
            onSave={(newCategory) => {
              onChangeCategory(book.id, newCategory);
              onClose();
            }}
          />
        )}

        {type === 'details' && (
          <BookDetailsModalContent
            book={book}
            progress={progress}
            onClose={onClose}
            onOpenReader={() => {
              onClose();
              onOpenReader(book);
            }}
          />
        )}

        {type === 'bookmark' && (
          <BookmarkModalContent
            book={book}
            onClose={onClose}
            onUpdate={(newPage) => {
              onUpdateBookmark(book.id, newPage);
              onClose();
            }}
          />
        )}

        {type === 'notes' && (
          <BookNotesModalContent
            book={book}
            onClose={onClose}
          />
        )}

        {type === 'remove' && (
          <ConfirmRemoveModalContent
            book={book}
            onClose={onClose}
            onConfirm={() => {
              onRemoveBook(book.id);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

// 1. Rename Book Modal Content
function RenameModalContent({ book, onClose, onSave }) {
  const [title, setTitle] = useState(book.title);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (title.trim()) {
      onSave(title.trim());
    }
  };

  return (
    <div className="action-modal-body">
      <div className="action-modal-icon-halo gold-halo">
        <Edit2 size={24} />
      </div>
      <h3 className="action-modal-title">Rename Book</h3>
      <p className="action-modal-desc">
        Change the display title for this volume in your sanctuary shelf.
      </p>

      <form onSubmit={handleSubmit} className="action-modal-form">
        <label className="input-label" htmlFor="rename-input">Book Title</label>
        <input
          id="rename-input"
          type="text"
          className="action-text-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <div className="action-modal-buttons">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!title.trim()}>
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}

// 2. Change Category Modal Content
function ChangeCategoryModalContent({ book, onClose, onSave }) {
  const [selectedCategory, setSelectedCategory] = useState(book.category || 'Computer Science');
  const availableCategories = LIBRARY_CATEGORIES.filter((c) => c !== 'All');

  return (
    <div className="action-modal-body">
      <div className="action-modal-icon-halo teal-halo">
        <Tag size={24} />
      </div>
      <h3 className="action-modal-title">Change Category</h3>
      <p className="action-modal-desc">
        Assign <strong>{book.title}</strong> to a shelf category for easier filtering.
      </p>

      <div className="category-selection-grid">
        {availableCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-option-btn ${selectedCategory === cat ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
          >
            <span>{cat}</span>
            {selectedCategory === cat && <CheckCircle2 size={16} className="text-teal" />}
          </button>
        ))}
      </div>

      <div className="action-modal-buttons">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onSave(selectedCategory)}
        >
          Update Category
        </button>
      </div>
    </div>
  );
}

// 3. Book Details Modal Content
function BookDetailsModalContent({ book, progress, onClose, onOpenReader }) {
  return (
    <div className="details-modal-layout">
      <div className="details-cover-col">
        <BookCover
          title={book.title}
          theme={book.coverTheme}
          coverUrl={book.coverUrl || book.coverImage || book.coverTheme?.coverUrl || book.coverTheme?.coverImage}
          size="medium"
        />
        <span className="details-file-badge">{book.format} Document</span>
      </div>

      <div className="details-info-col">
        <div className="details-category-pill">{book.category}</div>
        <h3 className="details-book-title">{book.title}</h3>
        <p className="details-author-text">Author: {book.author || 'Academic Series'}</p>
        <p className="details-description">{book.description}</p>

        <div className="details-stats-grid">
          <div className="stat-card">
            <span className="stat-label">Reading Position</span>
            <span className="stat-value">Page {book.currentPage} of {book.totalPages}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Progress</span>
            <span className="stat-value text-teal">{progress}% complete</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">File Size</span>
            <span className="stat-value">{book.fileSize || 'Approx 5 MB'}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Last Opened</span>
            <span className="stat-value">{book.lastOpened}</span>
          </div>
        </div>

        <div className="details-actions-row">
          <button className="btn-primary" onClick={onOpenReader}>
            <BookOpen size={16} />
            <span>Open in Reader</span>
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// 4. Bookmark Modal Content
function BookmarkModalContent({ book, onClose, onUpdate }) {
  const [targetPage, setTargetPage] = useState(book.currentPage);

  const handleSubmit = (e) => {
    e.preventDefault();
    const pageNum = parseInt(targetPage, 10);
    if (!isNaN(pageNum) && pageNum >= 0 && pageNum <= book.totalPages) {
      onUpdate(pageNum);
    }
  };

  return (
    <div className="action-modal-body">
      <div className="action-modal-icon-halo gold-halo">
        <Bookmark size={24} />
      </div>
      <h3 className="action-modal-title">Manage Bookmark</h3>
      <p className="action-modal-desc">
        Set your current reading checkpoint in <strong>{book.title}</strong>.
      </p>

      <form onSubmit={handleSubmit} className="action-modal-form">
        <div className="bookmark-page-selector">
          <label className="input-label" htmlFor="page-input">
            Bookmark Page (Total: {book.totalPages} pages)
          </label>
          <div className="number-input-row">
            <input
              id="page-input"
              type="number"
              min="0"
              max={book.totalPages}
              className="action-text-input"
              value={targetPage}
              onChange={(e) => setTargetPage(e.target.value)}
              required
            />
            <span className="page-max-indicator">/ {book.totalPages}</span>
          </div>
        </div>

        <div className="action-modal-buttons">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Update Bookmark
          </button>
        </div>
      </form>
    </div>
  );
}

// 5. Book Notes Modal Content
function BookNotesModalContent({ book, onClose }) {
  return (
    <div className="action-modal-body">
      <div className="action-modal-icon-halo amber-halo">
        <FileText size={24} />
      </div>
      <h3 className="action-modal-title">Book Notes & Marginalia</h3>
      <p className="action-modal-desc">
        Reflections recorded for <strong>{book.title}</strong>.
      </p>

      <div className="notes-list-box">
        <div className="note-item-card">
          <span className="note-chapter">Chapter Bookmark: Page {book.currentPage}</span>
          <p className="note-body">
            “Key takeaway: verify algorithmic invariant conditions during each iteration to maintain correctness.”
          </p>
          <span className="note-timestamp">Logged {book.lastOpened}</span>
        </div>
        <div className="note-item-card">
          <span className="note-chapter">Foundations & Overview</span>
          <p className="note-body">
            “Review space-time trade-off benchmarks before implementing dynamic programming memoization.”
          </p>
          <span className="note-timestamp">Session checkpoint</span>
        </div>
      </div>

      <div className="scope-boundary-box">
        <Info size={16} />
        <span>Full persistent note editor is scheduled for Screen 6.</span>
      </div>

      <div className="action-modal-buttons">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// 6. Confirm Remove Modal Content
function ConfirmRemoveModalContent({ book, onClose, onConfirm }) {
  return (
    <div className="action-modal-body">
      <div className="action-modal-icon-halo red-halo">
        <Trash2 size={24} />
      </div>
      <h3 className="action-modal-title">Remove from My Library</h3>
      <p className="action-modal-desc">
        Are you sure you want to remove <strong>{book.title}</strong> from your active shelf?
      </p>

      <div className="remove-clarification-callout">
        <AlertTriangle size={18} className="text-amber" />
        <span>
          <strong>Important:</strong> This only removes the volume from your Aks sanctuary
          shelf. Your original local PDF document remains completely safe and untouched on your device.
        </span>
      </div>

      <div className="action-modal-buttons">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Keep Book
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={onConfirm}
        >
          Remove from Library
        </button>
      </div>
    </div>
  );
}
