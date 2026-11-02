import React, { useState, useEffect } from 'react';
import { Clock, RotateCcw, BookOpen, AlertCircle } from 'lucide-react';
import {
  getTotalStudyTime,
  resetStudyTime,
  subscribeStudyTime,
  formatStudyTime,
} from '../services/studyTimeService';
import {
  fetchStudyStatistics,
  resetStudyStatistics,
  onAuthStateChanged,
} from '../services/sanctuaryDataService';

export default function StudyTimeCard() {
  const [totalSeconds, setTotalSeconds] = useState(() => getTotalStudyTime());
  const [showResetModal, setShowResetModal] = useState(false);

  // Sync server statistics when authenticated
  useEffect(() => {
    let isMounted = true;
    async function syncServerStats() {
      try {
        const stats = await fetchStudyStatistics();
        if (isMounted && typeof stats?.totalStudyTimeSeconds === 'number') {
          setTotalSeconds(stats.totalStudyTimeSeconds);
        }
      } catch (_) {}
    }
    syncServerStats();

    const unregAuth = onAuthStateChanged(() => {
      syncServerStats();
    });

    const unsubscribe = subscribeStudyTime((updatedSeconds) => {
      setTotalSeconds(updatedSeconds);
    });

    return () => {
      isMounted = false;
      unregAuth();
      unsubscribe();
    };
  }, []);

  // Keyboard accessibility for reset confirmation modal
  useEffect(() => {
    if (!showResetModal) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowResetModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showResetModal]);

  const handleConfirmReset = async () => {
    try {
      await resetStudyStatistics();
    } catch (_) {}
    resetStudyTime();
    setTotalSeconds(0);
    setShowResetModal(false);
  };

  const formatted = formatStudyTime(totalSeconds);

  return (
    <>
      <div className="welcome-time-card welcome-study-card" aria-label="Total Study Time card">
        <div className="time-card-header">
          <div className="study-header-left">
            <div className="time-card-icon-halo study-icon-halo">
              <Clock size={18} className="study-clock-icon" />
            </div>
            <span className="time-card-status study-status-title">Total Study Time</span>
          </div>

          <button
            type="button"
            className="study-reset-btn"
            onClick={() => setShowResetModal(true)}
            title="Reset total study time to zero"
            aria-label="Reset total study time"
          >
            <RotateCcw size={11} className="study-reset-icon" />
            <span>Reset</span>
          </button>
        </div>

        <div className="time-card-body">
          <div className="time-display study-time-display">
            <span className="study-hm-text">{formatted.displayHoursMinutes}</span>
            <span className="study-sec-badge" title="Active cumulative seconds">
              {formatted.displaySeconds}
            </span>
          </div>
          <div className="date-display study-sub-info">
            {totalSeconds > 0
              ? `${Math.floor(totalSeconds / 60)} minutes reading logged`
              : 'Sanctuary reading timer'}
          </div>
        </div>

        <div className="time-card-footer">
          <BookOpen size={13} className="sparkle-icon study-footer-icon" />
          <span className="calm-mind-text study-footer-caption">
            Time spent actively reading across all books
          </span>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showResetModal && (
        <div
          className="settings-modal-backdrop"
          onClick={() => setShowResetModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-study-modal-title"
        >
          <div
            className="settings-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <div className="settings-modal-icon-danger">
                <AlertCircle size={22} />
              </div>
              <h3 id="reset-study-modal-title" className="settings-modal-title">
                Reset your total study time to zero?
              </h3>
            </div>

            <div className="settings-modal-body">
              This will reset your cumulative reading timer across all books back to 0h 0m.
              <br />
              <br />
              <strong>
                Your reading progress, books, bookmarks, highlights, and notes will remain completely preserved.
              </strong>
            </div>

            <div className="settings-modal-actions">
              <button
                type="button"
                className="settings-modal-cancel"
                onClick={() => setShowResetModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-danger-btn"
                onClick={handleConfirmReset}
              >
                Reset Timer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
