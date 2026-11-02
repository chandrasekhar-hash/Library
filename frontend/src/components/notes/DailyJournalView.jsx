import React, { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Sparkles,
  BookOpen,
  Pin,
  Trash2,
  Edit3,
} from 'lucide-react';

export default function DailyJournalView({
  notes = [],
  selectedDate,
  onSelectDate,
  onSelectNote,
  selectedNoteId,
  onCreateJournalEntry,
  onDeleteNote,
}) {
  // Format dates for display
  const dateObj = useMemo(() => {
    if (!selectedDate) return new Date();
    const [year, month, day] = selectedDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }, [selectedDate]);

  const formattedDate = useMemo(() => {
    return dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [dateObj]);

  const isToday = useMemo(() => {
    const today = new Date();
    return (
      dateObj.getDate() === today.getDate() &&
      dateObj.getMonth() === today.getMonth() &&
      dateObj.getFullYear() === today.getFullYear()
    );
  }, [dateObj]);

  // Filter notes that belong to the selected date
  const dayNotes = useMemo(() => {
    const targetYmd = selectedDate;
    return notes
      .filter((n) => {
        // Match journalDate or createdAt date
        let noteYmd = null;
        if (n.journalDate) {
          const d = new Date(n.journalDate);
          noteYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } else if (n.createdAt) {
          const d = new Date(n.createdAt);
          noteYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        return noteYmd === targetYmd;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [notes, selectedDate]);

  const handlePrevDay = () => {
    const prev = new Date(dateObj);
    prev.setDate(prev.getDate() - 1);
    const ymd = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    onSelectDate(ymd);
  };

  const handleNextDay = () => {
    const next = new Date(dateObj);
    next.setDate(next.getDate() + 1);
    const ymd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    onSelectDate(ymd);
  };

  const handleGoToday = () => {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    onSelectDate(ymd);
  };

  return (
    <div className="aks-journal-view">
      {/* ── Date Navigation Header ───────────────────────────────────── */}
      <div className="aks-journal-nav-bar">
        <div className="aks-journal-date-controls">
          <button
            type="button"
            className="aks-journal-arrow-btn"
            onClick={handlePrevDay}
            title="Previous Day"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="aks-journal-date-display">
            <CalendarIcon size={16} className="text-gold" />
            <span className="aks-journal-heading-date">{formattedDate}</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && onSelectDate(e.target.value)}
              className="aks-journal-hidden-date-input"
              title="Pick a date"
            />
          </div>

          <button
            type="button"
            className="aks-journal-arrow-btn"
            onClick={handleNextDay}
            title="Next Day"
          >
            <ChevronRight size={16} />
          </button>

          {!isToday && (
            <button
              type="button"
              className="aks-journal-today-btn"
              onClick={handleGoToday}
              title="Jump to Today"
            >
              Today
            </button>
          )}
        </div>

        <button
          type="button"
          className="aks-journal-new-entry-btn"
          onClick={() => onCreateJournalEntry(selectedDate)}
          title="Create a new entry for this date"
        >
          <Plus size={15} />
          <span>New Journal Entry</span>
        </button>
      </div>

      {/* ── Day Entries List ─────────────────────────────────────────── */}
      <div className="aks-journal-entries-list">
        {dayNotes.length === 0 ? (
          <div className="aks-journal-empty-day">
            <Sparkles size={28} className="text-gold" />
            <h3>No entries for this day</h3>
            <p>Capture your thoughts, ideas, memories, or reflections for {formattedDate}.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onCreateJournalEntry(selectedDate)}
            >
              <Plus size={15} />
              <span>Write First Entry</span>
            </button>
          </div>
        ) : (
          <div className="aks-journal-timeline">
            {dayNotes.map((note, index) => {
              const isSelected = note.id === selectedNoteId;
              const timeStr = note.createdAt
                ? new Date(note.createdAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Entry';

              const plainSnippet = note.content
                ? note.content.slice(0, 160).replace(/\n/g, ' ')
                : 'Empty entry…';

              return (
                <div
                  key={note.id}
                  className={`aks-journal-entry-card ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectNote(note.id)}
                >
                  <div className="aks-journal-card-header">
                    <div className="aks-journal-card-time">
                      <Clock size={13} className="text-muted" />
                      <span>{timeStr}</span>
                      {note.isPinned && (
                        <span className="aks-note-pinned-tag" title="Pinned Note">
                          <Pin size={11} className="text-gold" /> Pinned
                        </span>
                      )}
                    </div>
                    {onDeleteNote && (
                      <button
                        type="button"
                        className="aks-journal-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNote(note);
                        }}
                        title="Delete Entry"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  <h4 className="aks-journal-card-title">{note.title || 'Untitled Entry'}</h4>
                  <p className="aks-journal-card-snippet">{plainSnippet}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

