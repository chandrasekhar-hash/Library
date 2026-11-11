/**
 * NotesPage.jsx
 * Aks (अक्स) — Personal Journal & Notes Workspace
 *
 * Implements:
 * - Two distinct areas: Personal Notebook & Daily Journal vs. Reading Notes
 * - Real IndexedDB & PostgreSQL persistence via sanctuaryDataService
 * - Reliable debounced auto-save with honest status ('saving', 'saved', 'error')
 * - Rich text TipTap editing with custom typography, fonts, colors, and 3 aesthetic appearances
 * - Custom user-owned sections and notebooks
 * - Free-form daily journal with interactive date picker and multiple entries per day
 * - Preserves all existing book-linked annotations and Reading Room integrations
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  BookOpen,
  Sparkles,
  Trash2,
  AlertCircle,
  Home,
  ChevronRight,
} from 'lucide-react';
import {
  fetchAllNotes,
  saveNewNote,
  updateExistingNote,
  deleteExistingNote,
  fetchNoteSections,
  saveNewSection,
  updateExistingSection,
  deleteExistingSection,
} from '../services/sanctuaryDataService';
import PersonalNotesView from '../components/notes/PersonalNotesView';
import ReadingNotesView from '../components/notes/ReadingNotesView';
import { useAuth } from '../context/AuthContext';
import '../styles/notes.css';

export default function NotesPage({
  books = [],
  onOpenBook,
  onNavigateTo,
}) {
  const { isOwnerViewingAccount } = useAuth();
  // Top-level workspace tab: 'personal' | 'reading'
  const [activeTab, setActiveTab] = useState('personal');

  // Notes and sections data
  const [notes, setNotes] = useState([]);
  const [sections, setSections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Selected note ID per tab
  const [selectedPersonalNoteId, setSelectedPersonalNoteId] = useState(null);
  const [selectedReadingNoteId, setSelectedReadingNoteId] = useState(null);

  // Autosave and concurrency state
  const [saveStatus, setSaveStatus] = useState('saved'); // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const saveTimeoutRef = useRef(null);
  const pendingUpdatesRef = useRef({});
  const lastSaveTimestampRef = useRef(0);

  // Delete modal state
  const [deletingNote, setDeletingNote] = useState(null);

  // Load all notes & sections
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [allNotes, allSections] = await Promise.all([
        fetchAllNotes(),
        fetchNoteSections(),
      ]);

      const safeNotes = Array.isArray(allNotes) ? allNotes : [];
      const safeSections = Array.isArray(allSections) ? allSections : [];

      setNotes(safeNotes);
      setSections(safeSections);

      // Select initial notes if available
      const personalNotes = safeNotes.filter((n) => !n.bookId && n.type !== 'BOOK');
      const readingNotes = safeNotes.filter((n) => n.bookId || n.type === 'BOOK');

      if (personalNotes.length > 0) {
        setSelectedPersonalNoteId((prev) => (personalNotes.some((n) => n.id === prev) ? prev : personalNotes[0].id));
      }
      if (readingNotes.length > 0) {
        setSelectedReadingNoteId((prev) => (readingNotes.some((n) => n.id === prev) ? prev : readingNotes[0].id));
      }
    } catch (err) {
      console.error('[NotesPage] Failed to load data:', err);
      setLoadError(err?.message || 'Unable to load personal notebook.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Active note getters
  const activePersonalNote = notes.find((n) => n.id === selectedPersonalNoteId) || null;
  const activeReadingNote = notes.find((n) => n.id === selectedReadingNoteId) || null;

  // ── Debounced Autosave Worker ──────────────────────────────────────────────
  const triggerDebouncedSave = useCallback((noteId, updates) => {
    if (!noteId) return;

    // Merge pending updates
    pendingUpdatesRef.current[noteId] = {
      ...(pendingUpdatesRef.current[noteId] || {}),
      ...updates,
    };

    setSaveStatus('saving');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const payloadToSave = pendingUpdatesRef.current[noteId];
      if (!payloadToSave) return;
      delete pendingUpdatesRef.current[noteId];

      const thisTimestamp = Date.now();
      lastSaveTimestampRef.current = thisTimestamp;

      try {
        await updateExistingNote(noteId, payloadToSave);

        // Only update status to saved if a newer save request hasn't been queued
        if (lastSaveTimestampRef.current === thisTimestamp) {
          setSaveStatus('saved');
          setLastSavedTime(new Date());
        }
      } catch (err) {
        console.error(`[NotesPage] Autosave failed for note ${noteId}:`, err);
        setSaveStatus('error');
      }
    }, 800);
  }, []);

  // Update note handler (updates local state immediately, then debounces API save)
  const handleUpdateNote = useCallback((noteId, updates) => {
    setNotes((prevNotes) =>
      prevNotes.map((n) => (n.id === noteId ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n))
    );
    triggerDebouncedSave(noteId, updates);
  }, [triggerDebouncedSave]);

  // Create new note handler
  const handleCreateNote = async (initialData = {}) => {
    setSaveStatus('saving');
    try {
      const created = await saveNewNote({
        title: initialData.title || '',
        content: initialData.content || '',
        richContent: initialData.richContent || null,
        sectionId: initialData.sectionId || null,
        journalDate: initialData.journalDate || null,
        bookId: initialData.bookId || null,
        bookTitle: initialData.bookTitle || null,
        page: initialData.page || null,
        type: initialData.type || (initialData.bookId ? 'BOOK' : 'STANDALONE'),
        category: initialData.category || 'Reflection',
        appearance: 'classic-paper',
      });

      setNotes((prev) => [created, ...prev]);

      if (created.bookId || created.type === 'BOOK') {
        setSelectedReadingNoteId(created.id);
      } else {
        setSelectedPersonalNoteId(created.id);
      }
      setSaveStatus('saved');
      setLastSavedTime(new Date());
      return created;
    } catch (err) {
      console.error('[NotesPage] Failed to create note:', err);
      setSaveStatus('error');
    }
  };

  // Delete note handler
  const handleDeleteNoteConfirm = async () => {
    if (!deletingNote) return;
    try {
      await deleteExistingNote(deletingNote.id);
      setNotes((prev) => prev.filter((n) => n.id !== deletingNote.id));

      if (deletingNote.id === selectedPersonalNoteId) {
        const remainingPersonal = notes.filter((n) => n.id !== deletingNote.id && !n.bookId);
        setSelectedPersonalNoteId(remainingPersonal[0]?.id || null);
      }
      if (deletingNote.id === selectedReadingNoteId) {
        const remainingReading = notes.filter((n) => n.id !== deletingNote.id && n.bookId);
        setSelectedReadingNoteId(remainingReading[0]?.id || null);
      }
      setDeletingNote(null);
    } catch (err) {
      console.error('[NotesPage] Failed to delete note:', err);
    }
  };

  // Section Handlers
  const handleCreateSection = async (sectionData) => {
    const sec = await saveNewSection(sectionData);
    setSections((prev) => [...prev, sec]);
    return sec;
  };

  const handleUpdateSection = async (sectionId, updates) => {
    const updated = await updateExistingSection(sectionId, updates);
    if (updated) {
      setSections((prev) => prev.map((s) => (s.id === sectionId ? updated : s)));
    }
    return updated;
  };

  const handleDeleteSection = async (sectionId) => {
    await deleteExistingSection(sectionId);
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    // Unlink in local state
    setNotes((prev) =>
      prev.map((n) => (n.sectionId === sectionId ? { ...n, sectionId: null } : n))
    );
  };

  const personalNotesCount = notes.filter((n) => !n.bookId && n.type !== 'BOOK').length;
  const readingNotesCount = notes.filter((n) => n.bookId || n.type === 'BOOK').length;

  return (
    <div className="aks-notes-page-root">
      {/* ── Editorial Header ───────────────────────────────────────────── */}
      <header className="aks-notes-main-header">
        <div className="aks-notes-header-left">
          <div className="aks-notes-badge-row">
            <span className="aks-badge-gold">
              <Sparkles size={12} className="text-gold" /> Personal Sanctuary
            </span>
          </div>
          <h1 className="aks-notes-page-title">Personal Journal & Notes</h1>
          <p className="aks-notes-page-subtitle">
            A quiet sanctuary for your daily thoughts, reflections, ideas, and volume annotations.
          </p>
        </div>

        {/* Tab Switcher: Personal Notebook vs Reading Notes */}
        <div className="aks-workspace-tab-group" role="tablist" aria-label="Notes Workspaces">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'personal'}
            className={`aks-workspace-tab ${activeTab === 'personal' ? 'active' : ''}`}
            onClick={() => setActiveTab('personal')}
          >
            <Sparkles size={14} />
            <span>Personal Notebook & Journal</span>
            <span className="aks-tab-pill">{personalNotesCount}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'reading'}
            className={`aks-workspace-tab ${activeTab === 'reading' ? 'active' : ''}`}
            onClick={() => setActiveTab('reading')}
          >
            <BookOpen size={14} />
            <span>Reading Notes</span>
            <span className="aks-tab-pill">{readingNotesCount}</span>
          </button>
        </div>
      </header>

      {/* ── Active Workspace Body ──────────────────────────────────────── */}
      <div className="aks-notes-workspace-container">
        {activeTab === 'personal' ? (
          <PersonalNotesView
            notes={notes}
            sections={sections}
            selectedNote={activePersonalNote}
            selectedNoteId={selectedPersonalNoteId}
            onSelectNote={setSelectedPersonalNoteId}
            onCreateNote={isOwnerViewingAccount ? null : handleCreateNote}
            onUpdateNote={isOwnerViewingAccount ? null : handleUpdateNote}
            onDeleteNote={isOwnerViewingAccount ? null : setDeletingNote}
            onCreateSection={isOwnerViewingAccount ? null : handleCreateSection}
            onUpdateSection={isOwnerViewingAccount ? null : handleUpdateSection}
            onDeleteSection={isOwnerViewingAccount ? null : handleDeleteSection}
            saveStatus={isOwnerViewingAccount ? 'saved' : saveStatus}
            lastSavedTime={lastSavedTime}
            isReadOnly={isOwnerViewingAccount}
            onManualSaveRetry={() => {
              if (selectedPersonalNoteId && !isOwnerViewingAccount) {
                handleUpdateNote(selectedPersonalNoteId, {});
              }
            }}
          />
        ) : (
          <ReadingNotesView
            notes={notes}
            books={books}
            selectedNote={activeReadingNote}
            selectedNoteId={selectedReadingNoteId}
            onSelectNote={setSelectedReadingNoteId}
            onCreateNote={isOwnerViewingAccount ? null : handleCreateNote}
            onUpdateNote={isOwnerViewingAccount ? null : handleUpdateNote}
            onDeleteNote={isOwnerViewingAccount ? null : setDeletingNote}
            onOpenBook={onOpenBook}
            saveStatus={isOwnerViewingAccount ? 'saved' : saveStatus}
            isReadOnly={isOwnerViewingAccount}
            onManualSaveRetry={() => {
              if (selectedReadingNoteId && !isOwnerViewingAccount) {
                handleUpdateNote(selectedReadingNoteId, {});
              }
            }}
          />
        )}
      </div>

      {/* ── Delete Note Confirmation Modal ───────────────────────────────── */}
      {deletingNote && (
        <div className="aks-modal-overlay" onClick={() => setDeletingNote(null)}>
          <div className="aks-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="aks-modal-icon-danger">
              <Trash2 size={24} />
            </div>
            <h3>Delete this note?</h3>
            <p>
              Are you sure you want to delete{' '}
              <strong>"{deletingNote.title || 'Untitled Note'}"</strong>? This action cannot be
              undone.
            </p>
            <div className="aks-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeletingNote(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDeleteNoteConfirm}
              >
                Delete Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
