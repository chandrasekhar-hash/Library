import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Bookmark,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  List,
  ListOrdered,
  CheckSquare,
  Square,
  Quote,
  Code,
  ArrowRight,
  Clock,
} from 'lucide-react';

export default function ReadingNotesView({
  notes = [],
  books = [],
  selectedNote,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onOpenBook,
  saveStatus = 'saved',
  onManualSaveRetry,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookFilter, setSelectedBookFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState('split'); // 'write' | 'preview' | 'split'

  // Filter book-linked notes only
  const readingNotes = useMemo(() => {
    return notes
      .filter((n) => {
        // Must be associated with a book or typed as BOOK
        if (!n.bookId && n.type !== 'BOOK') return false;

        if (selectedBookFilter !== 'all' && n.bookId !== selectedBookFilter) {
          return false;
        }

        if (categoryFilter !== 'all' && n.category !== categoryFilter) {
          return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = n.title?.toLowerCase().includes(q);
          const matchContent = n.content?.toLowerCase().includes(q);
          const matchBook = n.bookTitle?.toLowerCase().includes(q) || n.book?.title?.toLowerCase().includes(q);
          if (!matchTitle && !matchContent && !matchBook) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [notes, selectedBookFilter, categoryFilter, searchQuery]);

  // Markdown formatting helpers for reading notes
  const insertFormatting = (prefix, suffix = '') => {
    if (!selectedNote) return;
    const content = selectedNote.content || '';
    const textarea = document.getElementById('reading-note-textarea');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const replacement = `${prefix}${selectedText || 'text'}${suffix}`;
    const newContent = content.substring(0, start) + replacement + content.substring(end);

    onUpdateNote(selectedNote.id, { content: newContent });
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selectedText.length || 4));
    }, 10);
  };

  const handleToggleChecklist = (lineIndex) => {
    if (!selectedNote) return;
    const lines = (selectedNote.content || '').split('\n');
    if (lines[lineIndex] !== undefined) {
      if (lines[lineIndex].startsWith('- [ ]')) {
        lines[lineIndex] = lines[lineIndex].replace('- [ ]', '- [x]');
      } else if (lines[lineIndex].startsWith('- [x]')) {
        lines[lineIndex] = lines[lineIndex].replace('- [x]', '- [ ]');
      }
      onUpdateNote(selectedNote.id, { content: lines.join('\n') });
    }
  };

  return (
    <div className="aks-reading-notes-workspace">
      {/* ── Left Pane: Reading Notes Stream ────────────────────────────── */}
      <aside className="aks-reading-notes-sidebar">
        <div className="aks-stream-header">
          <div className="aks-stream-title-row">
            <h2>Reading Notes</h2>
            <button
              type="button"
              className="btn-primary aks-new-note-btn"
              onClick={() => {
                const firstBook = books[0];
                onCreateNote({
                  title: '',
                  content: '',
                  bookId: firstBook?.id || null,
                  bookTitle: firstBook?.title || null,
                  page: 1,
                  type: 'BOOK',
                  category: 'Reflection',
                });
              }}
              title="Create new reading note"
            >
              <Plus size={15} />
              <span>New Annotation</span>
            </button>
          </div>

          {/* Book Filter Dropdown */}
          <div className="aks-reading-filters-bar">
            <select
              value={selectedBookFilter}
              onChange={(e) => setSelectedBookFilter(e.target.value)}
              className="aks-reading-book-select"
            >
              <option value="all">All Volumes ({books.length})</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="aks-reading-book-select"
            >
              <option value="all">All Categories</option>
              <option value="Reflection">Reflection</option>
              <option value="Checklist">Checklist</option>
              <option value="Analysis">Analysis</option>
              <option value="Vocabulary">Vocabulary</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="aks-stream-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search volume annotations…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Notes List */}
        <div className="aks-notes-card-list">
          {readingNotes.length === 0 ? (
            <div className="aks-stream-empty">
              <BookOpen size={32} className="text-muted" />
              <p>No reading notes recorded for this volume.</p>
            </div>
          ) : (
            readingNotes.map((note) => {
              const isSelected = note.id === selectedNoteId;
              const bookTitle = note.bookTitle || note.book?.title || 'Unknown Volume';
              const snippet = note.content
                ? note.content.slice(0, 130).replace(/\n/g, ' ')
                : 'Empty reflection…';

              return (
                <div
                  key={note.id}
                  className={`aks-note-summary-card ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectNote(note.id)}
                >
                  <div className="aks-note-card-top">
                    <span className="aks-note-card-date">
                      <Clock size={11} />{' '}
                      {new Date(note.updatedAt || note.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    {note.page && (
                      <span className="aks-reading-page-tag">
                        Page {note.page}
                      </span>
                    )}
                  </div>

                  <h3 className="aks-note-card-title">{note.title || 'Untitled Note'}</h3>
                  <div className="aks-reading-card-book-title">
                    <BookOpen size={12} className="text-gold" />
                    <span>{bookTitle}</span>
                  </div>
                  <p className="aks-note-card-snippet">{snippet}</p>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Right Pane: Reading Note Editor & Resume Reading ───────────── */}
      <main className="aks-editor-main-pane">
        {selectedNote ? (
          <div className="aks-editor-surface">
            {/* Top Toolbar */}
            <div className="aks-editor-header-bar">
              <input
                type="text"
                className="aks-editor-title-input"
                placeholder="Note Title…"
                value={selectedNote.title || ''}
                onChange={(e) => onUpdateNote(selectedNote.id, { title: e.target.value })}
              />

              <div className="aks-editor-actions-strip">
                {/* Save status */}
                <div className="aks-save-status-indicator">
                  {saveStatus === 'saving' && (
                    <span className="aks-status-saving">
                      <Loader2 size={13} className="rdr-spin" /> Saving…
                    </span>
                  )}
                  {saveStatus === 'saved' && (
                    <span className="aks-status-saved">
                      <CheckCircle2 size={13} className="text-teal" /> Saved
                    </span>
                  )}
                  {saveStatus === 'error' && (
                    <button
                      type="button"
                      className="aks-status-error-btn"
                      onClick={onManualSaveRetry}
                    >
                      <AlertCircle size={13} /> Retry Save
                    </button>
                  )}
                </div>

                {/* Resume reading jump button */}
                {selectedNote.bookId && onOpenBook && (
                  <button
                    type="button"
                    className="aks-resume-reading-btn"
                    onClick={() => onOpenBook(selectedNote.bookId, selectedNote.page || 1)}
                    title="Open book in Reading Room at this page"
                  >
                    <span>Resume Reading</span>
                    <ArrowRight size={13} />
                  </button>
                )}

                <button
                  type="button"
                  className="aks-editor-action-btn aks-editor-action-btn--danger"
                  onClick={() => onDeleteNote(selectedNote)}
                  title="Delete Note"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {/* Sub-meta: Book and Page Association */}
            <div className="aks-reading-meta-bar">
              <div className="aks-reading-meta-item">
                <BookOpen size={13} className="text-gold" />
                <select
                  value={selectedNote.bookId || ''}
                  onChange={(e) => {
                    const book = books.find((b) => b.id === e.target.value);
                    onUpdateNote(selectedNote.id, {
                      bookId: e.target.value || null,
                      bookTitle: book?.title || null,
                    });
                  }}
                >
                  <option value="">No Book Association</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="aks-reading-meta-item">
                <Bookmark size={13} className="text-muted" />
                <span>Page:</span>
                <input
                  type="number"
                  min="1"
                  value={selectedNote.page || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onUpdateNote(selectedNote.id, { page: isNaN(val) ? null : val });
                  }}
                  className="aks-page-number-input"
                  placeholder="—"
                />
              </div>

              {/* View Mode Tabs (Write, Split, Preview) */}
              <div className="aks-view-mode-tabs">
                <button
                  type="button"
                  className={viewMode === 'write' ? 'active' : ''}
                  onClick={() => setViewMode('write')}
                >
                  Write
                </button>
                <button
                  type="button"
                  className={viewMode === 'split' ? 'active' : ''}
                  onClick={() => setViewMode('split')}
                >
                  Split
                </button>
                <button
                  type="button"
                  className={viewMode === 'preview' ? 'active' : ''}
                  onClick={() => setViewMode('preview')}
                >
                  Preview
                </button>
              </div>
            </div>

            {/* Markdown formatting quick bar */}
            {viewMode !== 'preview' && (
              <div className="aks-markdown-toolbar">
                <button type="button" onClick={() => insertFormatting('# ')} title="Heading 1">
                  <Heading1 size={14} />
                </button>
                <button type="button" onClick={() => insertFormatting('## ')} title="Heading 2">
                  <Heading2 size={14} />
                </button>
                <button type="button" onClick={() => insertFormatting('### ')} title="Heading 3">
                  <Heading3 size={14} />
                </button>
                <span className="aks-toolbar-divider" />
                <button type="button" onClick={() => insertFormatting('**', '**')} title="Bold">
                  <Bold size={14} />
                </button>
                <button type="button" onClick={() => insertFormatting('*', '*')} title="Italic">
                  <Italic size={14} />
                </button>
                <span className="aks-toolbar-divider" />
                <button type="button" onClick={() => insertFormatting('- ')} title="Bullet List">
                  <List size={14} />
                </button>
                <button type="button" onClick={() => insertFormatting('1. ')} title="Numbered List">
                  <ListOrdered size={14} />
                </button>
                <button type="button" onClick={() => insertFormatting('- [ ] ')} title="Checklist Item">
                  <CheckSquare size={14} />
                </button>
                <button type="button" onClick={() => insertFormatting('> ')} title="Blockquote">
                  <Quote size={14} />
                </button>
              </div>
            )}

            {/* Editor Textarea / Split Preview */}
            <div className={`aks-reading-editor-body aks-reading-editor-body--${viewMode}`}>
              {viewMode !== 'preview' && (
                <textarea
                  id="reading-note-textarea"
                  className="aks-reading-textarea"
                  placeholder="Record your reading reflections, chapter summaries, key questions, or vocabulary…"
                  value={selectedNote.content || ''}
                  onChange={(e) => onUpdateNote(selectedNote.id, { content: e.target.value })}
                />
              )}

              {viewMode !== 'write' && (
                <div className="aks-reading-preview-pane">
                  <RenderedNotePreview
                    content={selectedNote.content || ''}
                    onToggleChecklist={handleToggleChecklist}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="aks-editor-empty-state">
            <BookOpen size={36} className="text-gold" />
            <h3>Select a reading annotation or create a new one</h3>
            <p>Connect your personal thoughts and observations directly to pages in your books.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function RenderedNotePreview({ content, onToggleChecklist }) {
  if (!content || !content.trim()) {
    return (
      <div className="notes-preview-content" style={{ opacity: 0.5, fontStyle: 'italic' }}>
        Preview will render formatted headings, lists, bold text, and checklists here as you type.
      </div>
    );
  }

  const lines = content.split('\n');
  const elements = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={`empty-${idx}`} style={{ height: '8px' }} />);
      return;
    }
    if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
      const isChecked = trimmed.startsWith('- [x]');
      const taskText = trimmed.replace(/^-\s*\[[ x]\]\s*/, '');
      elements.push(
        <div key={`check-${idx}`} className="notes-checklist-item">
          <button
            type="button"
            className="notes-checkbox-btn"
            onClick={() => onToggleChecklist && onToggleChecklist(idx)}
          >
            {isChecked ? <CheckSquare size={16} className="text-teal" /> : <Square size={16} />}
          </button>
          <span className={isChecked ? 'notes-checklist-done' : ''}>{taskText}</span>
        </div>
      );
      return;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={`h3-${idx}`}>{line.slice(4)}</h3>);
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={`h2-${idx}`}>{line.slice(3)}</h2>);
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(<h1 key={`h1-${idx}`}>{line.slice(2)}</h1>);
      return;
    }
    if (line.startsWith('> ')) {
      elements.push(<blockquote key={`quote-${idx}`}>{line.slice(2)}</blockquote>);
      return;
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(<li key={`li-${idx}`}>{trimmed.slice(2)}</li>);
      return;
    }
    elements.push(<p key={`p-${idx}`}>{line}</p>);
  });

  return <div className="notes-preview-content">{elements}</div>;
}

