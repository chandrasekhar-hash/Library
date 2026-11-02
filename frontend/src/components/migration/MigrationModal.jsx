/**
 * MigrationModal.jsx
 * Aks (अक्स) — Phase 7 & 7.1: Safe Guest Data Migration Wizard
 *
 * Provides a gentle, explicit, and transparent migration experience for moving
 * local guest reading data (IndexedDB) into an authenticated account with
 * account-scoped isolation, retry-safety, and device-specific data disclosure.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Feather,
  BookOpen,
  FileCheck,
  Bookmark,
  Highlighter,
  FileText,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Sliders,
  HardDrive,
  Clock,
  Image,
} from 'lucide-react';
import { inspectGuestData, executeMigration } from '../../services/migrationService';
import '../../styles/migration.css';

export default function MigrationModal({
  isOpen,
  onClose,
  currentUser,
  onMigrationSuccess,
}) {
  const [step, setStep] = useState('loading'); // 'loading' | 'preview' | 'consent' | 'migrating' | 'complete' | 'error'
  const [preview, setPreview] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Selection state
  const [selectedBookIds, setSelectedBookIds] = useState(new Set());
  const [selectedNoteIds, setSelectedNoteIds] = useState(new Set());
  const [duplicateResolutions, setDuplicateResolutions] = useState({});
  const [progressPolicy, setProgressPolicy] = useState('prefer_guest');
  const [migratePreferences, setMigratePreferences] = useState(true);

  // Live migration progress
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    percent: 0,
    message: '',
    itemStatus: {},
  });
  const [migrationSummary, setMigrationSummary] = useState(null);

  const abortControllerRef = useRef(null);

  // Load preview data on open
  const loadPreview = useCallback(async () => {
    if (!currentUser) return;
    setStep('loading');
    setErrorMessage(null);

    try {
      const data = await inspectGuestData(currentUser);
      setPreview(data);

      if (!data.hasGuestData) {
        setStep('preview');
        return;
      }

      // Default select all valid books and notes
      const initialBookIds = new Set(data.books.filter((b) => b.isValid).map((b) => b.id));
      const initialNoteIds = new Set(data.standaloneNotes.map((n) => n.id));
      setSelectedBookIds(initialBookIds);
      setSelectedNoteIds(initialNoteIds);

      // Default duplicate resolutions
      const initialResolutions = {};
      data.books.forEach((b) => {
        if (b.duplicateType === 'PREVIOUSLY_MIGRATED' || b.duplicateType === 'EXACT_HASH_MATCH') {
          initialResolutions[b.id] = 'skip';
        } else if (b.duplicateType === 'TITLE_MATCH') {
          initialResolutions[b.id] = 'new_copy';
        } else {
          initialResolutions[b.id] = 'new_copy';
        }
      });
      setDuplicateResolutions(initialResolutions);

      setStep('preview');
    } catch (err) {
      console.error('[MigrationModal] Error loading preview:', err);
      setErrorMessage(err.message || 'Could not inspect local guest data.');
      setStep('error');
    }
  }, [currentUser]);

  useEffect(() => {
    if (isOpen) {
      loadPreview();
    }
  }, [isOpen, loadPreview]);

  if (!isOpen) return null;

  // Toggle book selection
  const handleToggleBook = (bookId) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  // Toggle note selection
  const handleToggleNote = (noteId) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  // Change resolution for a duplicate book
  const handleResolutionChange = (bookId, res) => {
    setDuplicateResolutions((prev) => ({
      ...prev,
      [bookId]: res,
    }));
  };

  // Start migration execution
  const handleStartMigration = async () => {
    setStep('migrating');
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const matchingServerBooks = {};
    if (preview?.books) {
      preview.books.forEach((b) => {
        if (b.matchingServerBook) {
          matchingServerBooks[b.id] = b.matchingServerBook;
        }
      });
    }

    try {
      const summary = await executeMigration(
        {
          selectedBookIds: Array.from(selectedBookIds),
          selectedNoteIds: Array.from(selectedNoteIds),
          duplicateResolutions,
          progressPolicy,
          matchingServerBooks,
          migratePreferences,
        },
        (prog) => {
          setProgress(prog);
        },
        controller.signal
      );

      setMigrationSummary(summary);
      setStep('complete');
      if (onMigrationSuccess) {
        onMigrationSuccess(summary);
      }
    } catch (err) {
      console.error('[MigrationModal] Migration execution failed:', err);
      setErrorMessage(err.message || 'Migration encountered an unexpected error.');
      setStep('error');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancelMigration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleRetryFailed = () => {
    if (migrationSummary?.errors && migrationSummary.errors.length > 0) {
      const failedIds = migrationSummary.errors.map((e) => e.itemId);
      const retryBooks = new Set(failedIds.filter((id) => preview.books.some((b) => b.id === id)));
      const retryNotes = new Set(failedIds.filter((id) => preview.standaloneNotes.some((n) => n.id === id)));
      setSelectedBookIds(retryBooks);
      setSelectedNoteIds(retryNotes);
      setStep('consent');
    } else {
      loadPreview();
    }
  };

  const totalSelectedCount = selectedBookIds.size + selectedNoteIds.size + (migratePreferences ? 1 : 0);

  return (
    <div className="migration-modal-backdrop" role="dialog" aria-modal="true">
      <div className="migration-modal-card">
        {/* Header */}
        <div className="migration-modal-header">
          <div className="migration-modal-header-left">
            <div className="migration-header-icon">
              <Feather size={20} />
            </div>
            <div>
              <h3 className="migration-modal-title">Sanctuary Data Migration</h3>
              <span className="migration-modal-sub">
                Transfer your local guest reading library safely into your account
              </span>
            </div>
          </div>
          {step !== 'migrating' && (
            <button className="migration-close-btn" onClick={onClose} aria-label="Close dialog">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="migration-modal-body">
          {/* Destination Account Pill */}
          {currentUser && (
            <div className="migration-account-pill">
              <div className="migration-account-user">
                <ShieldCheck size={16} className="text-teal" />
                <span>Destination: <strong>{currentUser.name}</strong> ({currentUser.email})</span>
              </div>
              <span className="migration-account-badge">Account-Scoped</span>
            </div>
          )}

          {/* 1. Loading Step */}
          {step === 'loading' && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <Loader2 size={36} className="migration-spin" style={{ color: '#E7C18A', margin: '0 auto 1rem' }} />
              <p style={{ color: '#E2E8F0', fontSize: '0.95rem' }}>Analyzing local guest data and destination account…</p>
            </div>
          )}

          {/* 2. Error Step */}
          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <AlertCircle size={42} style={{ color: '#F87171', margin: '0 auto 1rem' }} />
              <h4 style={{ color: '#F8F9FA', marginBottom: '0.5rem' }}>Migration Notice</h4>
              <p style={{ color: '#94A3B8', fontSize: '0.85rem', maxWidth: '480px', margin: '0 auto 1.5rem' }}>
                {errorMessage}
              </p>
              <button className="migration-btn-secondary" onClick={loadPreview}>
                <RotateCcw size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} /> Try Again
              </button>
            </div>
          )}

          {/* 3. Preview Step */}
          {step === 'preview' && preview && (
            <>
              {!preview.hasGuestData ? (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
                  <CheckCircle2 size={38} style={{ color: '#2DD4BF', margin: '0 auto 1rem' }} />
                  <h4 style={{ color: '#F8F9FA', marginBottom: '0.5rem' }}>No Local Guest Data Found</h4>
                  <p style={{ color: '#94A3B8', fontSize: '0.85rem' }}>
                    Your local storage is clean. All active reading data is already synced with your account.
                  </p>
                </div>
              ) : (
                <>
                  {/* Metrics Summary */}
                  <div className="migration-metrics-grid">
                    <div className="migration-metric-box">
                      <span className="migration-metric-val">{preview.totalBooks}</span>
                      <span className="migration-metric-lbl">Volumes</span>
                    </div>
                    <div className="migration-metric-box">
                      <span className="migration-metric-val">{preview.totalFiles}</span>
                      <span className="migration-metric-lbl">PDF Files</span>
                    </div>
                    <div className="migration-metric-box">
                      <span className="migration-metric-val">{preview.totalBookmarks}</span>
                      <span className="migration-metric-lbl">Bookmarks</span>
                    </div>
                    <div className="migration-metric-box">
                      <span className="migration-metric-val">{preview.totalHighlights}</span>
                      <span className="migration-metric-lbl">Highlights</span>
                    </div>
                    <div className="migration-metric-box">
                      <span className="migration-metric-val">{preview.totalNotes}</span>
                      <span className="migration-metric-lbl">Notes</span>
                    </div>
                    <div className="migration-metric-box">
                      <span className="migration-metric-val">{preview.totalProgress}</span>
                      <span className="migration-metric-lbl">Positions</span>
                    </div>
                  </div>

                  {/* Duplicate warning banner */}
                  {preview.duplicateCount > 0 && (
                    <div className="migration-alert-banner">
                      <AlertTriangle size={18} />
                      <div>
                        <strong>{preview.duplicateCount} item(s) match existing account records.</strong>
                        <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>
                          Review the conflict options below to link or create distinct copies.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Books List */}
                  {preview.books.length > 0 && (
                    <div className="migration-section">
                      <div className="migration-section-title">
                        <span>Volumes to Copy ({selectedBookIds.size}/{preview.books.length})</span>
                        <div className="migration-section-actions">
                          <button
                            type="button"
                            className="migration-text-link"
                            onClick={() => setSelectedBookIds(new Set(preview.books.map((b) => b.id)))}
                          >
                            Select All
                          </button>
                          <span>•</span>
                          <button
                            type="button"
                            className="migration-text-link"
                            onClick={() => setSelectedBookIds(new Set())}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      <div className="migration-items-list">
                        {preview.books.map((b) => {
                          const isSelected = selectedBookIds.has(b.id);
                          const currentRes = duplicateResolutions[b.id] || 'new_copy';

                          return (
                            <div key={b.id} className={`migration-item-row ${isSelected ? 'selected' : ''}`}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleBook(b.id)}
                                aria-label={`Select ${b.title}`}
                                className="migration-checkbox"
                              />
                              <div className="migration-item-info">
                                <span className="migration-item-title">{b.title}</span>
                                <span className="migration-item-meta">
                                  {b.author} • {b.totalPages} pages • {b.bookmarksCount} bookmarks • {b.highlightsCount} highlights • {b.notesCount} notes
                                </span>

                                {b.duplicateType && (
                                  <div className="migration-conflict-box">
                                    <span className="migration-conflict-label">
                                      {b.duplicateType === 'EXACT_HASH_MATCH' && 'Identical PDF exists on server'}
                                      {b.duplicateType === 'PREVIOUSLY_MIGRATED' && 'Previously migrated to your account'}
                                      {b.duplicateType === 'TITLE_MATCH' && 'Same title exists on server with different PDF'}
                                    </span>
                                    <select
                                      value={currentRes}
                                      onChange={(e) => handleResolutionChange(b.id, e.target.value)}
                                      className="migration-resolution-select"
                                    >
                                      <option value="skip">Skip (Leave as is)</option>
                                      <option value="link">Link & Merge Annotations</option>
                                      <option value="new_copy">Upload Separate Copy</option>
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Standalone Notes Section */}
                  {preview.standaloneNotes.length > 0 && (
                    <div className="migration-section">
                      <div className="migration-section-title">
                        <span>Standalone Reflections ({selectedNoteIds.size}/{preview.standaloneNotes.length})</span>
                      </div>
                      <div className="migration-items-list">
                        {preview.standaloneNotes.map((n) => (
                          <div key={n.id} className={`migration-item-row ${selectedNoteIds.has(n.id) ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={selectedNoteIds.has(n.id)}
                              onChange={() => handleToggleNote(n.id)}
                              aria-label={`Select note ${n.title}`}
                              className="migration-checkbox"
                            />
                            <div className="migration-item-info">
                              <span className="migration-item-title">{n.title || 'Untitled Reflection'}</span>
                              <span className="migration-item-meta">
                                Category: {n.category || 'Reflection'} • {n.content?.slice(0, 80) || 'Empty note'}…
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preferences Section */}
                  <div className="migration-section">
                    <div className="migration-section-title">
                      <span>Sanctuary Preferences</span>
                    </div>
                    <div className="migration-item-row selected" style={{ cursor: 'pointer' }} onClick={() => setMigratePreferences(!migratePreferences)}>
                      <input
                        type="checkbox"
                        checked={migratePreferences}
                        onChange={(e) => setMigratePreferences(e.target.checked)}
                        className="migration-checkbox"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="migration-item-info">
                        <span className="migration-item-title">Sync Reading & Atmosphere Preferences</span>
                        <span className="migration-item-meta">
                          Copies reading modes, typography settings, annotation color presets, and mood intensity to your cloud profile.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Device-Specific & Unsupported Items (Explicit Disclosure) */}
                  {preview.deviceSpecificData && preview.deviceSpecificData.length > 0 && (
                    <div className="migration-section">
                      <div className="migration-section-title" style={{ color: '#94A3B8' }}>
                        <span>Device-Specific & Local Data (Preserved Locally)</span>
                      </div>
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '8px',
                        padding: '0.75rem',
                        fontSize: '0.8rem',
                        color: '#94A3B8',
                      }}>
                        {preview.deviceSpecificData.map((d) => (
                          <div key={d.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.4rem 0', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <div>
                              <strong style={{ color: '#E2E8F0' }}>{d.name}</strong>: <span>{d.detail}</span>
                              <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.1rem' }}>{d.reason}</div>
                            </div>
                            <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(148, 163, 184, 0.1)', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                              Kept Local
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Conflict Policy Options */}
                  <div className="migration-section">
                    <div className="migration-section-title">
                      <span>Reading Position Policy</span>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#CBD5E1', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="progressPolicy"
                          value="prefer_guest"
                          checked={progressPolicy === 'prefer_guest'}
                          onChange={() => setProgressPolicy('prefer_guest')}
                        />
                        Use furthest page read
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#CBD5E1', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="progressPolicy"
                          value="prefer_server"
                          checked={progressPolicy === 'prefer_server'}
                          onChange={() => setProgressPolicy('prefer_server')}
                        />
                        Preserve server position
                      </label>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* 4. Consent Step */}
          {step === 'consent' && (
            <div style={{ padding: '1rem 0' }}>
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <ShieldCheck size={48} style={{ color: '#2DD4BF', margin: '0 auto 0.75rem' }} />
                <h4 style={{ color: '#F8F9FA', fontSize: '1.2rem', marginBottom: '0.4rem' }}>
                  Confirm Sanctuary Transfer
                </h4>
                <p style={{ color: '#94A3B8', fontSize: '0.85rem' }}>
                  You are about to copy <strong>{selectedBookIds.size} volume(s)</strong>, <strong>{selectedNoteIds.size} standalone note(s)</strong>, and preferences into:
                </p>
                <div style={{
                  display: 'inline-block',
                  background: 'rgba(231, 193, 138, 0.1)',
                  border: '1px solid rgba(231, 193, 138, 0.3)',
                  padding: '0.4rem 1rem',
                  borderRadius: '20px',
                  color: '#E7C18A',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  marginTop: '0.6rem',
                }}>
                  {currentUser.name} ({currentUser.email})
                </div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '1rem',
                fontSize: '0.8rem',
                color: '#CBD5E1',
                lineHeight: 1.6,
              }}>
                <p style={{ margin: '0 0 0.5rem 0' }}>
                  🛡️ <strong>Safety Guarantee:</strong> Your original local records in IndexedDB and localStorage will <em>never</em> be deleted or modified.
                </p>
                <p style={{ margin: '0 0 0.5rem 0' }}>
                  🔒 <strong>Account Isolation:</strong> All uploaded PDFs and annotations are private to your account and mapped strictly to your session.
                </p>
                <p style={{ margin: 0 }}>
                  ⚡ <strong>Idempotency & Recovery:</strong> Partially completed items can be safely retried anytime without creating duplicates.
                </p>
              </div>
            </div>
          )}

          {/* 5. In-Progress Migration */}
          {step === 'migrating' && (
            <div className="migration-progress-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: '#F8F9FA', fontWeight: 500 }}>
                  Migrating to Account…
                </span>
                <span style={{ fontSize: '0.9rem', color: '#E7C18A', fontWeight: 600 }}>
                  {progress.percent}%
                </span>
              </div>

              <div className="migration-progress-bar-track">
                <div className="migration-progress-bar-fill" style={{ width: `${progress.percent}%` }} />
              </div>

              <span className="migration-live-message">{progress.message}</span>

              {/* Real-time Checklist */}
              <div className="migration-status-checklist">
                {Object.entries(progress.itemStatus).map(([id, info]) => (
                  <div key={id} className={`migration-checklist-item ${info.status}`}>
                    <div>
                      <span>{info.title}</span>
                      {info.detail && <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginLeft: '0.5rem' }}>({info.detail})</span>}
                    </div>
                    <span>
                      {info.status === 'completed' && <CheckCircle2 size={15} style={{ color: '#2DD4BF' }} />}
                      {info.status === 'in_progress' && <Loader2 size={15} className="migration-spin" style={{ color: '#E7C18A' }} />}
                      {info.status === 'failed' && <AlertCircle size={15} style={{ color: '#F87171' }} title={info.error} />}
                      {info.status === 'skipped' && <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Skipped</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. Complete Step (Verification Summary) */}
          {step === 'complete' && migrationSummary && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <Sparkles size={44} style={{ color: '#E7C18A', margin: '0 auto 0.75rem' }} />
              <h4 style={{ color: '#F8F9FA', fontSize: '1.15rem', marginBottom: '0.4rem' }}>
                {migrationSummary.failedCount === 0 ? 'Migration Complete!' : 'Migration Partially Completed'}
              </h4>
              <p style={{ color: '#94A3B8', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Your selected reading data has been safely registered in your authenticated sanctuary.
              </p>

              <div className="migration-metrics-grid">
                <div className="migration-metric-box">
                  <span className="migration-metric-val">{migrationSummary.migratedBooksCount}</span>
                  <span className="migration-metric-lbl">Books Added</span>
                </div>
                <div className="migration-metric-box">
                  <span className="migration-metric-val">{migrationSummary.reusedBooksCount}</span>
                  <span className="migration-metric-lbl">Books Reused</span>
                </div>
                <div className="migration-metric-box">
                  <span className="migration-metric-val">{migrationSummary.migratedBookmarksCount + migrationSummary.reusedBookmarksCount}</span>
                  <span className="migration-metric-lbl">Bookmarks</span>
                </div>
                <div className="migration-metric-box">
                  <span className="migration-metric-val">{migrationSummary.migratedHighlightsCount + migrationSummary.reusedHighlightsCount}</span>
                  <span className="migration-metric-lbl">Highlights</span>
                </div>
                <div className="migration-metric-box">
                  <span className="migration-metric-val">{migrationSummary.migratedNotesCount + migrationSummary.reusedNotesCount}</span>
                  <span className="migration-metric-lbl">Notes</span>
                </div>
                <div className="migration-metric-box">
                  <span className="migration-metric-val">{migrationSummary.preferencesMigrated ? 'Synced' : 'Default'}</span>
                  <span className="migration-metric-lbl">Preferences</span>
                </div>
              </div>

              {migrationSummary.failedCount > 0 && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  color: '#F87171',
                  fontSize: '0.8rem',
                  margin: '1rem 0',
                }}>
                  {migrationSummary.failedCount} item(s) could not be migrated. Original records remain safe on your device.
                  <div style={{ marginTop: '0.5rem' }}>
                    <button className="migration-btn-secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }} onClick={handleRetryFailed}>
                      <RotateCcw size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} /> Retry Failed Items
                    </button>
                  </div>
                </div>
              )}

              <div style={{
                fontSize: '0.75rem',
                color: '#64748B',
                marginTop: '1.25rem',
                textAlign: 'left',
                background: 'rgba(255, 255, 255, 0.02)',
                padding: '0.75rem',
                borderRadius: '6px',
              }}>
                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Verification Summary:</span>
                <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0 }}>
                  <li>Local IndexedDB and localStorage copies remain 100% intact.</li>
                  <li>Device-specific study statistics and custom wallpapers are preserved on this browser.</li>
                  <li>Account migration journal updated to prevent duplication on future syncs.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="migration-modal-footer">
          <div className="migration-footer-left">
            <span>Guest data remains safe on this device.</span>
          </div>

          <div className="migration-footer-actions">
            {step === 'preview' && (
              <>
                <button className="migration-btn-secondary" onClick={onClose}>
                  Skip / Keep Local
                </button>
                {preview?.hasGuestData && totalSelectedCount > 0 && (
                  <button className="migration-btn-primary" onClick={() => setStep('consent')}>
                    Continue <ArrowRight size={14} />
                  </button>
                )}
              </>
            )}

            {step === 'consent' && (
              <>
                <button className="migration-btn-secondary" onClick={() => setStep('preview')}>
                  Back
                </button>
                <button className="migration-btn-primary" onClick={handleStartMigration}>
                  Confirm & Migrate
                </button>
              </>
            )}

            {step === 'migrating' && (
              <button className="migration-btn-secondary" onClick={handleCancelMigration}>
                Cancel Migration
              </button>
            )}

            {step === 'complete' && (
              <button className="migration-btn-primary" onClick={onClose}>
                Enter Sanctuary
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
