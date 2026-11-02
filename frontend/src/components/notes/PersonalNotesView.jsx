import React, { useState, useMemo, useRef } from 'react';
import {
  Folder,
  Plus,
  Search,
  Pin,
  Calendar,
  Sparkles,
  BookOpen,
  Trash2,
  Edit2,
  MoreVertical,
  Check,
  X,
  Clock,
  ArrowUpDown,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Tag,
} from 'lucide-react';
import RichTextEditor from './RichTextEditor';
import DailyJournalView from './DailyJournalView';

export default function PersonalNotesView({
  notes = [],
  sections = [],
  selectedNote,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
  saveStatus = 'saved', // 'idle' | 'saving' | 'saved' | 'error'
  lastSavedTime = null,
  onManualSaveRetry,
}) {
  // Navigation & section selection
  const [activeSectionId, setActiveSectionId] = useState('all'); // 'all' | 'daily-journal' | sectionId
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recently-edited'); // 'recently-edited' | 'recently-created' | 'title'

  // Section editing modal / prompt state
  const [isCreatingSection, setIsCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editSectionName, setEditSectionName] = useState('');
  const [sectionMenuId, setSectionMenuId] = useState(null);

  // Daily journal date selection (YYYY-MM-DD)
  const [selectedJournalDate, setSelectedJournalDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });

  // Filter notes by active section & search
  const filteredNotes = useMemo(() => {
    return notes
      .filter((n) => {
        // Only standalone / personal notes
        if (n.type === 'BOOK' && n.bookId) return false;

        // Section filter
        if (activeSectionId === 'daily-journal') {
          // In daily journal mode, show all journal entries or notes belonging to Daily Journal section
          const isJournalSec = sections.find((s) => s.id === n.sectionId)?.name === 'Daily Journal';
          if (!isJournalSec && !n.journalDate) return false;
        } else if (activeSectionId !== 'all') {
          if (n.sectionId !== activeSectionId) return false;
        }

        // Search query filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = n.title?.toLowerCase().includes(q);
          const matchContent = n.content?.toLowerCase().includes(q);
          if (!matchTitle && !matchContent) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Pinned notes always surface first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        if (sortBy === 'recently-created') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortBy === 'title') {
          return (a.title || '').localeCompare(b.title || '');
        }
        // Default recently-edited
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      });
  }, [notes, sections, activeSectionId, searchQuery, sortBy]);

  // Section handling
  const handleCreateSectionSubmit = async (e) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    try {
      await onCreateSection({ name: newSectionName.trim() });
      setNewSectionName('');
      setIsCreatingSection(false);
    } catch (err) {
      console.error('Failed to create section:', err);
    }
  };

  const handleUpdateSectionSubmit = async (sectionId) => {
    if (!editSectionName.trim()) return;
    try {
      await onUpdateSection(sectionId, { name: editSectionName.trim() });
      setEditingSectionId(null);
      setEditSectionName('');
    } catch (err) {
      console.error('Failed to update section:', err);
    }
  };

  const handleCreateNoteInSection = (sectionIdOverride) => {
    const secId = sectionIdOverride || (activeSectionId === 'all' || activeSectionId === 'daily-journal' ? null : activeSectionId);
    let journalDate = null;
    let secToAssign = secId;

    if (activeSectionId === 'daily-journal') {
      journalDate = selectedJournalDate;
      const journalSec = sections.find((s) => s.name === 'Daily Journal');
      if (journalSec) secToAssign = journalSec.id;
    }

    onCreateNote({
      title: '',
      content: '',
      sectionId: secToAssign,
      journalDate,
      type: 'STANDALONE',
    });
  };

  return (
    <div className="aks-personal-notes-workspace">
      {/* ── 1. Sections Sidebar (Left Navigation) ───────────────────────── */}
      <aside className="aks-sections-sidebar">
        <div className="aks-sections-header">
          <span className="aks-sidebar-title">Notebooks & Sections</span>
          <button
            type="button"
            className="aks-icon-add-btn"
            onClick={() => setIsCreatingSection(true)}
            title="Create Custom Section"
          >
            <Plus size={15} />
          </button>
        </div>

        {/* Create new section inline input */}
        {isCreatingSection && (
          <form className="aks-new-section-form" onSubmit={handleCreateSectionSubmit}>
            <input
              type="text"
              placeholder="Section Name…"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              autoFocus
            />
            <div className="aks-new-section-actions">
              <button type="submit" className="btn-save">
                <Check size={13} />
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setIsCreatingSection(false);
                  setNewSectionName('');
                }}
              >
                <X size={13} />
              </button>
            </div>
          </form>
        )}

        <nav className="aks-sections-nav" aria-label="Personal Notebook Sections">
          {/* Virtual: All Notes */}
          <button
            type="button"
            className={`aks-section-item ${activeSectionId === 'all' ? 'active' : ''}`}
            onClick={() => setActiveSectionId('all')}
          >
            <div className="aks-section-label-group">
              <Sparkles size={15} className="text-gold" />
              <span>All Personal Notes</span>
            </div>
            <span className="aks-section-count">
              {notes.filter((n) => !n.bookId).length}
            </span>
          </button>

          {/* Virtual / Dedicated: Daily Journal */}
          <button
            type="button"
            className={`aks-section-item ${activeSectionId === 'daily-journal' ? 'active' : ''}`}
            onClick={() => setActiveSectionId('daily-journal')}
          >
            <div className="aks-section-label-group">
              <Calendar size={15} className="text-gold" />
              <span>Daily Journal</span>
            </div>
            <span className="aks-section-count">
              {
                notes.filter(
                  (n) =>
                    !n.bookId &&
                    (n.journalDate || sections.find((s) => s.id === n.sectionId)?.name === 'Daily Journal')
                ).length
              }
            </span>
          </button>

          <div className="aks-sections-divider" />
          <div className="aks-sections-subheading">Personal Sections</div>

          {/* User Sections List */}
          {sections.map((sec) => {
            const isEditing = editingSectionId === sec.id;
            const count = notes.filter((n) => n.sectionId === sec.id && !n.bookId).length;

            return (
              <div
                key={sec.id}
                className={`aks-section-item-wrapper ${activeSectionId === sec.id ? 'active' : ''}`}
              >
                {isEditing ? (
                  <div className="aks-section-inline-edit">
                    <input
                      type="text"
                      value={editSectionName}
                      onChange={(e) => setEditSectionName(e.target.value)}
                      autoFocus
                    />
                    <button type="button" onClick={() => handleUpdateSectionSubmit(sec.id)}>
                      <Check size={12} />
                    </button>
                    <button type="button" onClick={() => setEditingSectionId(null)}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`aks-section-item ${activeSectionId === sec.id ? 'active' : ''}`}
                    onClick={() => setActiveSectionId(sec.id)}
                  >
                    <div className="aks-section-label-group">
                      <span
                        className="aks-section-dot"
                        style={{ background: sec.color || '#e7c18a' }}
                      />
                      <span>{sec.name}</span>
                    </div>
                    <div className="aks-section-right-actions">
                      <span className="aks-section-count">{count}</span>
                      <button
                        type="button"
                        className="aks-section-more-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSectionMenuId(sectionMenuId === sec.id ? null : sec.id);
                        }}
                        title="Section options"
                      >
                        <MoreVertical size={13} />
                      </button>
                    </div>
                  </button>
                )}

                {/* Section dropdown options menu */}
                {sectionMenuId === sec.id && (
                  <div className="aks-section-menu-popover">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSectionId(sec.id);
                        setEditSectionName(sec.name);
                        setSectionMenuId(null);
                      }}
                    >
                      <Edit2 size={12} /> Rename
                    </button>
                    <button
                      type="button"
                      className="text-danger"
                      onClick={() => {
                        onDeleteSection(sec.id);
                        setSectionMenuId(null);
                        if (activeSectionId === sec.id) setActiveSectionId('all');
                      }}
                    >
                      <Trash2 size={12} /> Delete Section
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── 2. Middle Pane: Notes Stream / Journal View ────────────────── */}
      <section className="aks-notes-stream-pane">
        <div className="aks-stream-header">
          <div className="aks-stream-title-row">
            <h2>
              {activeSectionId === 'all'
                ? 'All Notes'
                : activeSectionId === 'daily-journal'
                ? 'Daily Journal'
                : sections.find((s) => s.id === activeSectionId)?.name || 'Notes'}
            </h2>
            <button
              type="button"
              className="btn-primary aks-new-note-btn"
              onClick={() => handleCreateNoteInSection()}
              title="Create new note in this section"
            >
              <Plus size={15} />
              <span>New Note</span>
            </button>
          </div>

          {/* Search & Sort Controls */}
          <div className="aks-stream-controls">
            <div className="aks-stream-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search notes & thoughts…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="aks-stream-sort">
              <ArrowUpDown size={13} className="text-muted" />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="recently-edited">Recently Edited</option>
                <option value="recently-created">Created Date</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>
        </div>

        {/* Daily Journal Date Strip (if Daily Journal mode) */}
        {activeSectionId === 'daily-journal' ? (
          <DailyJournalView
            notes={notes}
            selectedDate={selectedJournalDate}
            onSelectDate={setSelectedJournalDate}
            onSelectNote={onSelectNote}
            selectedNoteId={selectedNoteId}
            onCreateJournalEntry={(date) => {
              const journalSec = sections.find((s) => s.name === 'Daily Journal');
              onCreateNote({
                title: '',
                content: '',
                sectionId: journalSec?.id || null,
                journalDate: date,
                type: 'STANDALONE',
              });
            }}
            onDeleteNote={onDeleteNote}
          />
        ) : (
          /* Notes Card List */
          <div className="aks-notes-card-list">
            {filteredNotes.length === 0 ? (
              <div className="aks-stream-empty">
                <FileText size={32} className="text-muted" />
                <p>No notes found in this section.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleCreateNoteInSection()}
                >
                  <Plus size={14} /> Write an entry
                </button>
              </div>
            ) : (
              filteredNotes.map((note) => {
                const isSelected = note.id === selectedNoteId;
                const section = sections.find((s) => s.id === note.sectionId);
                const snippet = note.content
                  ? note.content.slice(0, 140).replace(/\n/g, ' ')
                  : 'Empty entry…';

                const dateDisplay = note.journalDate
                  ? new Date(note.journalDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : new Date(note.updatedAt || note.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    });

                return (
                  <div
                    key={note.id}
                    className={`aks-note-summary-card ${isSelected ? 'active' : ''}`}
                    onClick={() => onSelectNote(note.id)}
                  >
                    <div className="aks-note-card-top">
                      <span className="aks-note-card-date">
                        <Clock size={11} /> {dateDisplay}
                      </span>
                      {note.isPinned && (
                        <span className="aks-note-pinned-tag" title="Pinned Note">
                          <Pin size={11} className="text-gold" /> Pinned
                        </span>
                      )}
                    </div>

                    <h3 className="aks-note-card-title">
                      {note.title || 'Untitled Note'}
                    </h3>
                    <p className="aks-note-card-snippet">{snippet}</p>

                    <div className="aks-note-card-footer">
                      {section && (
                        <span className="aks-note-section-tag">
                          <span
                            className="aks-section-mini-dot"
                            style={{ background: section.color || '#e7c18a' }}
                          />
                          {section.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      {/* ── 3. Right Pane: Rich Text Writing Canvas ────────────────────── */}
      <main className="aks-editor-main-pane">
        {selectedNote ? (
          <div className="aks-editor-surface">
            {/* Header: Title & Meta Actions */}
            <div className="aks-editor-header-bar">
              <div className="aks-editor-title-container">
                <input
                  type="text"
                  className="aks-editor-title-input"
                  placeholder="Title (optional)…"
                  value={selectedNote.title || ''}
                  onChange={(e) => onUpdateNote(selectedNote.id, { title: e.target.value })}
                />
              </div>

              {/* Status and Action Buttons */}
              <div className="aks-editor-actions-strip">
                {/* Save Status Indicator */}
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
                      title="Save failed. Click to retry."
                    >
                      <AlertCircle size={13} /> Retry Save
                    </button>
                  )}
                </div>

                {/* Section Assignment Dropdown */}
                <div className="aks-editor-meta-select-wrapper">
                  <Tag size={13} className="text-muted" />
                  <select
                    value={selectedNote.sectionId || ''}
                    onChange={(e) =>
                      onUpdateNote(selectedNote.id, {
                        sectionId: e.target.value ? e.target.value : null,
                      })
                    }
                    title="Assign section"
                  >
                    <option value="">No Section</option>
                    {sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Pin Button */}
                <button
                  type="button"
                  className={`aks-editor-action-btn ${selectedNote.isPinned ? 'active' : ''}`}
                  onClick={() =>
                    onUpdateNote(selectedNote.id, { isPinned: !selectedNote.isPinned })
                  }
                  title={selectedNote.isPinned ? 'Unpin Note' : 'Pin Note to Top'}
                >
                  <Pin size={15} />
                </button>

                {/* Delete Button */}
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

            {/* Note Sub-meta (Dates) */}
            <div className="aks-editor-date-subtext">
              <span>
                Created{' '}
                {new Date(selectedNote.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <span>•</span>
              <span>
                Edited{' '}
                {new Date(selectedNote.updatedAt || selectedNote.createdAt).toLocaleTimeString(
                  'en-US',
                  { hour: 'numeric', minute: '2-digit' }
                )}
              </span>
            </div>

            {/* TipTap Rich Text Writing Canvas */}
            <RichTextEditor
              key={selectedNote.id}
              initialRichContent={selectedNote.richContent}
              initialPlainText={selectedNote.content}
              appearance={selectedNote.appearance || 'classic-paper'}
              onAppearanceChange={(newAppearance) =>
                onUpdateNote(selectedNote.id, { appearance: newAppearance })
              }
              typography={selectedNote.typography}
              onTypographyChange={(newTypography) =>
                onUpdateNote(selectedNote.id, { typography: newTypography })
              }
              onChange={({ richContent, plainText }) => {
                onUpdateNote(selectedNote.id, {
                  richContent,
                  content: plainText,
                });
              }}
            />
          </div>
        ) : (
          <div className="aks-editor-empty-state">
            <Sparkles size={36} className="text-gold" />
            <h3>Select a note or begin a new entry</h3>
            <p>
              Your personal sanctuary for daily thoughts, reflections, ideas, and memories.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleCreateNoteInSection()}
            >
              <Plus size={15} />
              <span>Create Note</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

