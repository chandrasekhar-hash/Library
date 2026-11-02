/**
 * NotesDrawer.jsx
 * Right-side slide-out notes panel for the Reading Room.
 * Notes are linked to a bookId and optionally to a specific page.
 * Persists via the onSaveNotes callback (backed by IndexedDB in ReaderPage).
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  StickyNote,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  FileText,
  BookOpen,
  AlertCircle,
} from 'lucide-react';

let noteIdCounter = Date.now();
const newId = () => `note-${++noteIdCounter}-${Math.random().toString(36).slice(2, 6)}`;

export default function NotesDrawer({
  isOpen,
  notes = [],
  currentPage,
  bookTitle,
  bookId,
  onClose,
  onSaveNotes,
}) {
  const [localNotes, setLocalNotes] = useState(notes);
  const [draftText, setDraftText] = useState('');
  const [draftPage, setDraftPage] = useState('current'); // 'current' | 'general'
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saveTimerRef = useRef(null);
  const textareaRef = useRef(null);

  // Sync when external notes prop changes (on book load)
  useEffect(() => {
    const normalized = (notes || []).map((n) => ({
      ...n,
      text: n.text || n.content || '',
      content: n.content || n.text || '',
    }));
    setLocalNotes(normalized);
  }, [notes]);

  // Auto-focus textarea when drawer opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 220);
    }
  }, [isOpen]);

  const handleAddNote = async () => {
    const text = draftText.trim();
    if (!text || isSubmitting) return;

    setIsSubmitting(true);
    setSaveState('saving');
    setErrorMessage('');

    const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').trim();
    const title = firstLine.slice(0, 48) || `Note on Page ${draftPage === 'current' ? currentPage : 'General'}`;
    const pageNum = draftPage === 'current' ? currentPage : null;

    const tempId = newId();
    const note = {
      id: tempId,
      title,
      content: text,
      text,
      bookId: bookId || null,
      bookTitle: bookTitle || null,
      page: pageNum,
      type: 'book',
      category: 'Reflection',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (onSaveNotes) {
        const savedNote = await onSaveNotes([note, ...localNotes], { type: 'add', note });
        const finalNote = savedNote && savedNote.id ? savedNote : note;
        setLocalNotes((prev) => [
          finalNote,
          ...prev.filter((n) => n.id !== tempId && n.id !== finalNote.id),
        ]);
      } else {
        setLocalNotes((prev) => [note, ...prev]);
      }

      // Clear draft ONLY after save has successfully completed
      setDraftText('');
      setSaveState('saved');
      setErrorMessage('');
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      console.error('[NotesDrawer] Save note failed:', err);
      setSaveState('error');
      setErrorMessage(err?.message || 'Save failed. Please try again.');
      // Keep draftText intact so user does not lose typed notes!
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!onSaveNotes) return;
    const previous = localNotes;
    const updated = localNotes.filter((n) => n.id !== noteId);
    setLocalNotes(updated);
    setSaveState('saving');
    setErrorMessage('');
    try {
      await onSaveNotes(updated, { type: 'delete', noteId });
      setSaveState('saved');
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      setLocalNotes(previous);
      setSaveState('error');
      setErrorMessage(err?.message || 'Could not delete note.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAddNote();
    }
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  };

  // Group notes: current page vs other pages
  const pageNotes = localNotes.filter((n) => n.page === currentPage);
  const otherNotes = localNotes.filter((n) => n.page !== currentPage);

  return (
    <aside
      className={`notes-drawer ${isOpen ? 'notes-drawer--open' : ''}`}
      aria-label="My Notes panel"
      aria-hidden={!isOpen}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="notes-drawer-header">
        <div className="notes-drawer-title">
          <StickyNote size={16} className="notes-drawer-icon" />
          <span>My Notes</span>
          {localNotes.length > 0 && (
            <span className="notes-count-badge">{localNotes.length}</span>
          )}
        </div>
        <button
          className="notes-close-btn"
          onClick={onClose}
          aria-label="Close notes panel"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Save status ─────────────────────────────────────────────────────── */}
      <div className="notes-save-status" aria-live="polite">
        {saveState === 'saving' && (
          <span className="notes-status notes-status--saving">
            <Loader2 size={12} className="rdr-spin" /> Saving…
          </span>
        )}
        {saveState === 'saved' && (
          <span className="notes-status notes-status--saved">
            <CheckCircle2 size={12} /> Saved to library
          </span>
        )}
        {saveState === 'error' && (
          <span className="notes-status notes-status--error" title={errorMessage}>
            <AlertCircle size={12} /> {errorMessage || 'Save failed'}
          </span>
        )}
      </div>

      {/* ── New note form ────────────────────────────────────────────────────── */}
      <div className="notes-editor-section">
        <div className="notes-scope-toggle" role="group" aria-label="Note scope">
          <button
            className={`notes-scope-btn ${draftPage === 'current' ? 'notes-scope-btn--active' : ''}`}
            onClick={() => setDraftPage('current')}
            aria-pressed={draftPage === 'current'}
          >
            <BookOpen size={12} />
            Page {currentPage}
          </button>
          <button
            className={`notes-scope-btn ${draftPage === 'general' ? 'notes-scope-btn--active' : ''}`}
            onClick={() => setDraftPage('general')}
            aria-pressed={draftPage === 'general'}
          >
            <FileText size={12} />
            General
          </button>
        </div>

        <textarea
          ref={textareaRef}
          className="notes-textarea"
          placeholder={
            draftPage === 'current'
              ? `Add a note for page ${currentPage}… (Ctrl+Enter to save)`
              : `Add a general note about "${bookTitle}"… (Ctrl+Enter to save)`
          }
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          aria-label="Note text"
        />

        <button
          className="notes-add-btn btn-primary"
          onClick={handleAddNote}
          disabled={!draftText.trim() || isSubmitting}
          aria-label="Save note"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={15} className="rdr-spin" />
              <span>Saving…</span>
            </>
          ) : (
            <>
              <Plus size={15} />
              <span>Add Note</span>
            </>
          )}
        </button>
      </div>

      {/* ── Notes list ───────────────────────────────────────────────────────── */}
      <div className="notes-list-container">
        {localNotes.length === 0 ? (
          <div className="notes-empty-state">
            <StickyNote size={28} className="notes-empty-icon" />
            <p>No notes yet.</p>
            <span>Add your first note above.</span>
          </div>
        ) : (
          <>
            {/* Current page notes */}
            {pageNotes.length > 0 && (
              <div className="notes-group">
                <h4 className="notes-group-label">
                  <BookOpen size={12} />
                  Page {currentPage}
                </h4>
                {pageNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    formatDate={formatDate}
                    onDelete={handleDeleteNote}
                  />
                ))}
              </div>
            )}

            {/* Other page notes */}
            {otherNotes.length > 0 && (
              <div className="notes-group">
                <h4 className="notes-group-label">
                  <FileText size={12} />
                  Other pages & general notes
                </h4>
                {otherNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    formatDate={formatDate}
                    onDelete={handleDeleteNote}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function NoteCard({ note, formatDate, onDelete }) {
  const noteBody = note.content || note.text || '';
  return (
    <div className="note-card" role="article">
      <div className="note-card-meta">
        {note.page != null ? (
          <span className="note-page-tag">
            <BookOpen size={10} /> p.{note.page}
          </span>
        ) : (
          <span className="note-page-tag note-page-tag--general">
            <FileText size={10} /> General
          </span>
        )}
        <span className="note-date">{formatDate(note.createdAt)}</span>
        <button
          className="note-delete-btn"
          onClick={() => onDelete(note.id)}
          aria-label={`Delete note: ${noteBody.slice(0, 30)}`}
          title="Delete note"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <p className="note-text">{noteBody}</p>
    </div>
  );
}
