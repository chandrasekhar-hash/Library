import React from 'react';
import {
  X,
  BookOpen,
  FileText,
  Bookmark,
  Highlighter,
  Settings,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export default function PlaceholderModal({
  type,
  books = [],
  onClose,
  onSelectBookToRead,
}) {
  if (!type) return null;

  const renderContent = () => {
    switch (type) {
      case 'library':
        return (
          <div className="placeholder-modal-inner">
            <div className="placeholder-icon-halo teal-halo">
              <BookOpen size={28} />
            </div>
            <h3 className="placeholder-title">My Library</h3>
            <p className="placeholder-desc">
              Preview of your saved literary collection and active shelf.
            </p>

            <div className="library-sample-list">
              {books.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', textAlign: 'center', padding: '16px 0' }}>
                  No books in library yet.
                </p>
              ) : (
                books.map((book) => (
                  <div key={book.id} className="library-sample-item">
                    <div className="sample-item-info">
                      <span className="sample-item-title">{book.title}</span>
                      <span className="sample-item-meta">
                        {book.currentPage} of {book.totalPages} pages ({Math.round((book.currentPage / book.totalPages) * 100)}%) • {book.category}
                      </span>
                    </div>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        onClose();
                        onSelectBookToRead(book);
                      }}
                    >
                      Open
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="scope-boundary-box">
              <Sparkles size={16} />
              <span>
                The full <strong>My Library screen</strong> with custom shelves, sorting, and tag filters
                is available on Page 2.
              </span>
            </div>
          </div>
        );

      case 'notes':
        return (
          <div className="placeholder-modal-inner">
            <div className="placeholder-icon-halo amber-halo">
              <FileText size={28} />
            </div>
            <h3 className="placeholder-title">My Notes & Annotations</h3>
            <p className="placeholder-desc">
              Thoughts, marginalia, and study reflections across your books.
            </p>

            <div className="sample-notes-preview">
              <div className="sample-note-card">
                <span className="sample-note-tag">Data Structures • Chapter 3</span>
                <p className="sample-note-text">
                  “Red-black trees ensure worst-case insertion time stays strictly O(log n) through rotation recoloring.”
                </p>
                <span className="sample-note-date">Saved yesterday</span>
              </div>
              <div className="sample-note-card">
                <span className="sample-note-tag">Operating Systems • Page 56</span>
                <p className="sample-note-text">
                  “Notice how paging avoids external fragmentation while keeping page table translation fast with TLB.”
                </p>
                <span className="sample-note-date">Saved 3 days ago</span>
              </div>
            </div>

            <div className="scope-boundary-box">
              <AlertCircle size={16} />
              <span>
                The full <strong>Notebook & Markdown Editor</strong> is scheduled for Screen 6.
              </span>
            </div>
          </div>
        );

      case 'highlights':
        return (
          <div className="placeholder-modal-inner">
            <div className="placeholder-icon-halo gold-halo">
              <Highlighter size={28} />
            </div>
            <h3 className="placeholder-title">My Highlights</h3>
            <p className="placeholder-desc">
              All colored quotations and marked excerpts from your readings.
            </p>
            <div className="sample-highlights-box">
              <blockquote className="highlight-quote">
                “A calm mind reads deeper than an anxious clock.”
              </blockquote>
              <span className="highlight-source">— Aks Literary Collection</span>
            </div>
            <div className="scope-boundary-box">
              <AlertCircle size={16} />
              <span>
                Full highlight manager and PDF text selector will be added in Screen 4.
              </span>
            </div>
          </div>
        );

      case 'bookmarks':
        return (
          <div className="placeholder-modal-inner">
            <div className="placeholder-icon-halo teal-halo">
              <Bookmark size={28} />
            </div>
            <h3 className="placeholder-title">My Bookmarks</h3>
            <p className="placeholder-desc">
              Quick checkpoints and dog-eared pages ready to resume.
            </p>
            <div className="sample-bookmarks-list">
              <div className="sample-bookmark-row">
                <span>Data Structures — Page 12 (Current Chapter)</span>
                <span className="bookmark-pill">Active</span>
              </div>
              <div className="sample-bookmark-row">
                <span>Discrete Mathematics — Page 23</span>
                <span className="bookmark-pill">Saved</span>
              </div>
            </div>
            <div className="scope-boundary-box">
              <AlertCircle size={16} />
              <span>
                Full bookmark gallery is scheduled for Screen 5.
              </span>
            </div>
          </div>
        );

      case 'settings':
        return (
          <div className="placeholder-modal-inner">
            <div className="placeholder-icon-halo">
              <Settings size={28} />
            </div>
            <h3 className="placeholder-title">Sanctuary Settings</h3>
            <p className="placeholder-desc">
              Reader typography, page transitions, and storage preferences.
            </p>
            <div className="settings-preview-row">
              <span>Storage Engine</span>
              <span className="settings-val">IndexedDB (Offline & Persistent)</span>
            </div>
            <div className="settings-preview-row">
              <span>Typography Engine</span>
              <span className="settings-val">Playfair Display & Plus Jakarta Sans</span>
            </div>
            <div className="scope-boundary-box">
              <AlertCircle size={16} />
              <span>
                Complete settings manager is planned for Screen 7.
              </span>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="placeholder-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal-close-icon-btn"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        {renderContent()}

        <div className="modal-footer-simple">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
