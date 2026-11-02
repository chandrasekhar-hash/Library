/**
 * studyTimeService.js
 * Aks (अक्स) — Persistent Total Study Time Service
 *
 * Provides:
 * - Versioned localStorage persistence (`folio_total_study_time_v1`)
 * - Cumulative duration tracking across all books read in the Reading Room
 * - Active session filtering: only accumulates when document is visible and window is focused
 * - Safe suspension & sleep clamping (does not count background/suspended duration)
 * - Safe reset with immediate UI reactivity
 * - Cross-tab synchronization via storage events
 * - `useStudyTimer` React hook for Reading Room integration
 */
import { useEffect } from 'react';

export const STUDY_TIME_STORAGE_KEY = 'folio_total_study_time_v1';
export const CURRENT_STUDY_TIME_VERSION = 1;

/**
 * Retrieve total study time in seconds from localStorage
 * @returns {number} cumulative seconds (integer >= 0)
 */
export function getTotalStudyTime() {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const raw = localStorage.getItem(STUDY_TIME_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.totalSeconds === 'number' && Number.isFinite(parsed.totalSeconds)) {
      return Math.max(0, Math.floor(parsed.totalSeconds));
    }
    return 0;
  } catch (err) {
    console.warn('[studyTimeService] Could not read study time:', err);
    return 0;
  }
}

/**
 * Add active seconds to cumulative total study time
 * @param {number} secondsToAdd
 * @returns {number} new total seconds
 */
export function addStudyTime(secondsToAdd) {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  if (!secondsToAdd || secondsToAdd <= 0) return getTotalStudyTime();
  try {
    const current = getTotalStudyTime();
    const updated = current + Math.floor(secondsToAdd);
    const payload = {
      version: CURRENT_STUDY_TIME_VERSION,
      totalSeconds: updated,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(STUDY_TIME_STORAGE_KEY, JSON.stringify(payload));
    notifyStudyTimeListeners(updated);
    return updated;
  } catch (err) {
    console.warn('[studyTimeService] Could not save study time:', err);
    return getTotalStudyTime();
  }
}

/**
 * Reset total study time to zero
 * @returns {number} 0
 */
export function resetStudyTime() {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const payload = {
      version: CURRENT_STUDY_TIME_VERSION,
      totalSeconds: 0,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(STUDY_TIME_STORAGE_KEY, JSON.stringify(payload));
    notifyStudyTimeListeners(0);
    return 0;
  } catch (err) {
    console.warn('[studyTimeService] Could not reset study time:', err);
    return 0;
  }
}

/**
 * Format cumulative seconds into hours, minutes, seconds and readable text
 * @param {number} totalSeconds
 * @returns {{ hours: number, minutes: number, seconds: number, displayHoursMinutes: string, displaySeconds: string, fullText: string }}
 */
export function formatStudyTime(totalSeconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return {
    hours,
    minutes,
    seconds,
    displayHoursMinutes: `${hours}h ${minutes}m`,
    displaySeconds: `${seconds.toString().padStart(2, '0')}s`,
    fullText: hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`,
  };
}

/**
 * Listener registry for reactive multi-component synchronization
 */
const listeners = new Set();

export function subscribeStudyTime(callback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyStudyTimeListeners(newSeconds) {
  listeners.forEach((fn) => {
    try {
      fn(newSeconds);
    } catch (e) {
      console.warn('[studyTimeService] Listener error:', e);
    }
  });
}

// Cross-tab synchronization via storage event
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STUDY_TIME_STORAGE_KEY) {
      const updated = getTotalStudyTime();
      notifyStudyTimeListeners(updated);
    }
  });
}

/**
 * Custom React hook for tracking study time while active in the Reading Room.
 * 
 * - Only tracks while `isReading` is true (book is open and ready in Reading Room)
 * - Pauses when document is hidden (tab switched, minimized)
 * - Pauses when window is blurred/unfocused
 * - Resumes when document is visible and focused
 * - Clamps time deltas to prevent counting during sleep/hibernation
 * - Flushes pending seconds on navigation, unmount, mode switch, and beforeunload
 */
export function useStudyTimer({ isReading = false }) {
  useEffect(() => {
    if (!isReading) return;

    let isDocumentActive =
      typeof document !== 'undefined' &&
      !document.hidden &&
      (typeof document.hasFocus === 'function' ? document.hasFocus() : true);

    let lastTickTime = Date.now();
    let pendingSeconds = 0;

    const flush = () => {
      if (pendingSeconds > 0) {
        addStudyTime(pendingSeconds);
        pendingSeconds = 0;
      }
      lastTickTime = Date.now();
    };

    const intervalId = setInterval(() => {
      const now = Date.now();
      const deltaMs = now - lastTickTime;
      lastTickTime = now;

      if (isDocumentActive) {
        const deltaSec = Math.floor(deltaMs / 1000);
        // Normal 1-second tick (or small scheduling jitter up to 3 seconds)
        if (deltaSec >= 1 && deltaSec <= 3) {
          pendingSeconds += deltaSec;
          flush(); // Flush to localStorage so Home and other views stay immediately updated
        } else if (deltaSec > 3) {
          // System was asleep or throttled; discard gap
          pendingSeconds = 0;
        }
      }
    }, 1000);

    const onVisibilityChange = () => {
      if (document.hidden) {
        isDocumentActive = false;
        flush();
      } else {
        lastTickTime = Date.now();
        isDocumentActive = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      }
    };

    const onFocus = () => {
      if (!document.hidden) {
        lastTickTime = Date.now();
        isDocumentActive = true;
      }
    };

    const onBlur = () => {
      isDocumentActive = false;
      flush();
    };

    const onBeforeUnload = () => {
      flush();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [isReading]);
}
