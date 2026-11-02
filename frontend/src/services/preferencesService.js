/**
 * preferencesService.js
 * Aks (अक्स) — Sanctuary Preferences & Settings Storage Engine (Page 7)
 *
 * Provides:
 * - Versioned localStorage persistence (`folio_sanctuary_settings_v1`)
 * - Deep validation and safe fallback on corrupt or partial JSON
 * - Global sanctuary defaults + stable per-book override management
 * - Effective settings resolution: BookOverrides > GlobalDefaults
 * - Change subscription listeners for reactive cross-component synchronization
 * - Data export utilities (Notes Markdown/JSON, Bookmarks JSON, Library Metadata)
 * - Safe reset and data management helpers
 */

import { preferencesApi } from './api.js';

export const PREFERENCES_STORAGE_KEY = 'folio_sanctuary_settings_v1';
export const CURRENT_SETTINGS_VERSION = 1;

/**
 * Canonical default sanctuary preferences schema
 */
export const DEFAULT_PREFERENCES = {
  version: CURRENT_SETTINGS_VERSION,
  global: {
    reading: {
      defaultMode: 'book', // 'book' | 'pdf' | 'focus'
      pageTurnAnimation: true, // boolean
      animationSpeed: 'normal', // 'slow' (800ms) | 'normal' (500ms) | 'fast' (250ms)
      layout: 'double', // 'single' | 'double'
      scrollDirection: 'vertical', // 'vertical' | 'horizontal'
      scrollBehavior: 'smooth', // 'smooth' | 'auto'
      fullscreenPreference: 'off', // 'auto' | 'off'
      distractionFree: false, // boolean
      pageTurnSound: true, // boolean - Realistic paper page-turning sound in Book Mode
    },
    typography: {
      fontFamily: 'serif', // 'serif' | 'sans' | 'mono' | 'lexend'
      fontSize: 18, // 12 - 28 px
      lineHeight: 1.7, // 1.3 - 2.2
      margins: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
      surfaceTheme: 'navy', // 'navy' | 'cream' | 'slate' | 'contrast'
    },
    annotations: {
      defaultMarker: 'peacock-feather', // 'peacock-feather' | 'classic-ribbon' | 'geometric-leaf' | 'modern-pin'
      markerColor: 'gold', // 'gold' | 'teal' | 'emerald' | 'amber' | 'indigo'
      customMarkerUrl: null, // string (data url) or null
      defaultHighlightColor: 'gold', // 'gold' | 'teal' | 'emerald' | 'amber' | 'indigo' | 'rose'
      showTimestamps: true,
      autoOpenDrawer: false,
      defaultCategory: 'Reflection', // 'Reflection' | 'Quote' | 'Analysis' | 'Vocabulary'
    },
    atmosphere: {
      currentMoodId: 'modern-dark', // 'warm-literary' | 'modern-dark' | 'minimal-clean' | 'colorful-personal'
      backgroundMode: 'classic', // 'classic' | 'custom' | 'pure-white' | 'pure-black'
      backgroundScope: 'all', // 'home' | 'all'
      backgroundIntensity: 'subtle', // 'subtle' | 'immersive'
      backgroundDimming: 20, // 0 - 80 %
      blurIntensity: 0, // 0 - 20 px
      positioning: 'center', // 'center' | 'top' | 'bottom'
      motionEnabled: true,
      customMediaMeta: null, // { type: string, name: string, size: number, mimeType: string } | null
    },
    theme: {
      primaryColor: '#080E19',
      accentColor: '#E7C18A',
      isCustom: false,
    },
    storage: {
      autoSaveProgress: true,
      autoSaveNotes: true,
      syncInterval: 'instant',
    },
  },
  bookOverrides: {},
};

// Registered listeners for reactive preference changes
const listeners = new Set();

export function subscribePreferences(callback) {
  if (typeof callback === 'function') {
    listeners.add(callback);
  }
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(newPrefs) {
  listeners.forEach((callback) => {
    try {
      callback(newPrefs);
    } catch (err) {
      console.warn('[PreferencesService] Error notifying listener:', err);
    }
  });
}

/**
 * Validates and deeply merges loaded preferences with default schema
 */
export function sanitizePreferences(raw) {
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  }

  const sanitized = {
    version: CURRENT_SETTINGS_VERSION,
    global: {
      reading: {
        ...DEFAULT_PREFERENCES.global.reading,
        ...(raw.global?.reading || {}),
      },
      typography: {
        ...DEFAULT_PREFERENCES.global.typography,
        ...(raw.global?.typography || {}),
      },
      annotations: {
        ...DEFAULT_PREFERENCES.global.annotations,
        ...(raw.global?.annotations || {}),
      },
      atmosphere: {
        ...DEFAULT_PREFERENCES.global.atmosphere,
        ...(raw.global?.atmosphere || {}),
      },
      theme: {
        ...DEFAULT_PREFERENCES.global.theme,
        ...(raw.global?.theme || {}),
      },
      storage: {
        ...DEFAULT_PREFERENCES.global.storage,
        ...(raw.global?.storage || {}),
      },
    },
    bookOverrides:
      raw.bookOverrides && typeof raw.bookOverrides === 'object'
        ? raw.bookOverrides
        : {},
  };

  // Clamp numeric values to sensible bounds
  const r = sanitized.global.reading;
  if (!['book', 'pdf', 'focus'].includes(r.defaultMode)) r.defaultMode = 'book';
  if (!['slow', 'normal', 'fast'].includes(r.animationSpeed)) r.animationSpeed = 'normal';
  if (!['single', 'double'].includes(r.layout)) r.layout = 'double';
  if (!['vertical', 'horizontal'].includes(r.scrollDirection)) r.scrollDirection = 'vertical';
  if (typeof r.pageTurnSound !== 'boolean') r.pageTurnSound = true;

  const t = sanitized.global.typography;
  if (typeof t.fontSize !== 'number' || t.fontSize < 12 || t.fontSize > 28) t.fontSize = 18;
  if (typeof t.lineHeight !== 'number' || t.lineHeight < 1.3 || t.lineHeight > 2.2) t.lineHeight = 1.7;
  if (!['compact', 'comfortable', 'spacious'].includes(t.margins)) t.margins = 'comfortable';
  if (!['navy', 'cream', 'slate', 'contrast'].includes(t.surfaceTheme)) t.surfaceTheme = 'navy';

  const a = sanitized.global.atmosphere;
  if (!['warm-literary', 'modern-dark', 'minimal-clean', 'colorful-personal'].includes(a.currentMoodId)) {
    a.currentMoodId = 'modern-dark';
  }
  if (!['classic', 'custom', 'pure-white', 'pure-black'].includes(a.backgroundMode)) {
    a.backgroundMode = 'classic';
  }
  if (!['home', 'all'].includes(a.backgroundScope)) {
    a.backgroundScope = 'all';
  }
  if (!['center', 'top', 'bottom'].includes(a.positioning)) {
    a.positioning = 'center';
  }
  if (!['subtle', 'immersive'].includes(a.backgroundIntensity)) {
    a.backgroundIntensity = 'subtle';
  }
  if (typeof a.backgroundDimming !== 'number' || isNaN(a.backgroundDimming)) {
    a.backgroundDimming = 20;
  } else {
    a.backgroundDimming = Math.min(80, Math.max(0, Math.round(a.backgroundDimming)));
  }
  if (typeof a.blurIntensity !== 'number' || isNaN(a.blurIntensity)) {
    a.blurIntensity = 0;
  } else {
    a.blurIntensity = Math.min(20, Math.max(0, Math.round(a.blurIntensity)));
  }
  if (typeof a.motionEnabled !== 'boolean') {
    a.motionEnabled = true;
  }

  if (!sanitized.global.theme || typeof sanitized.global.theme !== 'object') {
    sanitized.global.theme = {
      primaryColor: '#080E19',
      accentColor: '#E7C18A',
      isCustom: false,
    };
  } else {
    const th = sanitized.global.theme;
    if (typeof th.primaryColor !== 'string' || !th.primaryColor) th.primaryColor = '#080E19';
    if (typeof th.accentColor !== 'string' || !th.accentColor) th.accentColor = '#E7C18A';
    th.isCustom = Boolean(th.isCustom);
  }

  return sanitized;
}

/**
 * Helper to safely resolve localStorage
 */
function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
}

/**
 * Loads current preferences from localStorage with fallback
 */
export function loadPreferences() {
  const storage = getStorage();
  if (!storage) {
    return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  }

  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
    }
    const parsed = JSON.parse(raw);
    return sanitizePreferences(parsed);
  } catch (err) {
    console.warn('[PreferencesService] Malformed JSON in localStorage, using defaults:', err);
    return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  }
}

/**
 * Persists preferences object to localStorage
 */
export function savePreferences(prefs) {
  const storage = getStorage();
  if (!storage) {
    throw new Error('Local storage is not supported in this environment.');
  }

  const sanitized = sanitizePreferences(prefs);
  const serialized = JSON.stringify(sanitized);

  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, serialized);
    // Double check read-back for integrity
    const verify = storage.getItem(PREFERENCES_STORAGE_KEY);
    if (!verify) {
      throw new Error('Verification read-back failed.');
    }
    notifyListeners(sanitized);

    // Sync with backend if user is authenticated
    try {
      const rawUser = localStorage.getItem('aks_auth_user');
      if (rawUser) {
        const g = sanitized.global || {};
        preferencesApi.updateGlobalPreferences({
          readingConfig: g.reading,
          typographyConfig: g.typography,
          annotationsConfig: g.annotations,
          atmosphereConfig: g.atmosphere,
          storageConfig: g.storage,
        }).catch((err) => {
          console.warn('[PreferencesService] Server sync notice:', err);
        });
      }
    } catch (_) {}

    return sanitized;
  } catch (err) {
    console.error('[PreferencesService] Failed to save preferences:', err);
    throw err;
  }
}

/**
 * Hydrates global preferences from the server when authenticated.
 */
export async function syncGlobalPreferencesFromServer() {
  try {
    const rawUser = localStorage.getItem('aks_auth_user');
    if (!rawUser) return null;

    const res = await preferencesApi.getGlobalPreferences();
    if (res?.preferences) {
      const serverPrefs = res.preferences;
      const current = loadPreferences();
      const updated = {
        ...current,
        global: {
          ...current.global,
          reading: { ...current.global.reading, ...(serverPrefs.readingConfig || {}) },
          typography: { ...current.global.typography, ...(serverPrefs.typographyConfig || {}) },
          annotations: { ...current.global.annotations, ...(serverPrefs.annotationsConfig || {}) },
          atmosphere: { ...current.global.atmosphere, ...(serverPrefs.atmosphereConfig || {}) },
          storage: { ...current.global.storage, ...(serverPrefs.storageConfig || {}) },
        },
      };
      const sanitized = sanitizePreferences(updated);
      const storage = getStorage();
      if (storage) {
        storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(sanitized));
      }
      notifyListeners(sanitized);
      return sanitized;
    }
  } catch (err) {
    console.warn('[PreferencesService] Server global preferences fetch failed:', err);
  }
  return null;
}

/**
 * Hydrates volume-specific overrides from the server when authenticated.
 */
export async function syncBookOverridesFromServer(bookId) {
  if (!bookId) return null;
  try {
    const rawUser = localStorage.getItem('aks_auth_user');
    if (!rawUser) return null;

    const res = await preferencesApi.getBookPreferences(bookId);
    if (res?.config) {
      const current = loadPreferences();
      const cfg = res.config;
      const updated = {
        ...current,
        bookOverrides: {
          ...(current.bookOverrides || {}),
          [bookId]: {
            reading: cfg.readingConfig || cfg.reading || {},
            typography: cfg.typographyConfig || cfg.typography || {},
            annotations: cfg.annotationsConfig || cfg.annotations || {},
            atmosphere: cfg.atmosphereConfig || cfg.atmosphere || {},
          },
        },
      };
      const sanitized = sanitizePreferences(updated);
      const storage = getStorage();
      if (storage) {
        storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(sanitized));
      }
      notifyListeners(sanitized);
      return res.config;
    }
  } catch (err) {
    console.warn('[PreferencesService] Server book overrides fetch failed:', err);
  }
  return null;
}

/**
 * Resolves effective preferences for a given book:
 * Inherits Global defaults, overridden by any explicitly set book overrides.
 */
export function getEffectivePreferences(bookId = null) {
  const prefs = loadPreferences();
  if (!bookId || !prefs.bookOverrides || !prefs.bookOverrides[bookId]) {
    return prefs.global;
  }

  const overrides = prefs.bookOverrides[bookId];
  return {
    reading: {
      ...prefs.global.reading,
      ...(overrides.reading || {}),
    },
    typography: {
      ...prefs.global.typography,
      ...(overrides.typography || {}),
    },
    annotations: {
      ...prefs.global.annotations,
      ...(overrides.annotations || {}),
    },
    atmosphere: {
      ...prefs.global.atmosphere,
      ...(overrides.atmosphere || {}),
    },
    storage: {
      ...prefs.global.storage,
      ...(overrides.storage || {}),
    },
  };
}

/**
 * Updates a specific category in global preferences
 */
export function updateGlobalCategory(category, updates) {
  const current = loadPreferences();
  current.global[category] = {
    ...(current.global[category] || {}),
    ...updates,
  };
  return savePreferences(current);
}

/**
 * Sets an override for a specific book in a specific category
 */
export function setBookOverride(bookId, category, updates) {
  if (!bookId) return loadPreferences();

  const current = loadPreferences();
  if (!current.bookOverrides[bookId]) {
    current.bookOverrides[bookId] = {};
  }
  current.bookOverrides[bookId][category] = {
    ...(current.bookOverrides[bookId][category] || {}),
    ...updates,
  };
  const saved = savePreferences(current);

  // Sync book override with server if authenticated
  try {
    const rawUser = localStorage.getItem('aks_auth_user');
    if (rawUser && bookId) {
      preferencesApi.updateBookPreferences(bookId, {
        readingConfig: current.bookOverrides[bookId].reading || null,
        typographyConfig: current.bookOverrides[bookId].typography || null,
        annotationsConfig: current.bookOverrides[bookId].annotations || null,
        atmosphereConfig: current.bookOverrides[bookId].atmosphere || null,
      }).catch(() => {});
    }
  } catch (_) {}

  return saved;
}

/**
 * Clears overrides for a specific book
 * If category is provided, clears only that category; otherwise clears all overrides for the book.
 */
export function removeBookOverride(bookId, category = null) {
  if (!bookId) return loadPreferences();

  const current = loadPreferences();
  if (!current.bookOverrides || !current.bookOverrides[bookId]) {
    return current;
  }

  if (category && current.bookOverrides[bookId][category]) {
    delete current.bookOverrides[bookId][category];
    // If no remaining category overrides, clean up the book key entirely
    if (Object.keys(current.bookOverrides[bookId]).length === 0) {
      delete current.bookOverrides[bookId];
    }
  } else {
    delete current.bookOverrides[bookId];
  }

  return savePreferences(current);
}

/**
 * Resets global preferences to default
 * If category is provided, resets only that category; otherwise resets all global settings.
 */
export function resetGlobalCategory(category = null) {
  const current = loadPreferences();
  if (category && DEFAULT_PREFERENCES.global[category]) {
    current.global[category] = JSON.parse(
      JSON.stringify(DEFAULT_PREFERENCES.global[category])
    );
  } else {
    current.global = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES.global));
  }
  return savePreferences(current);
}

/**
 * Resets all settings back to pristine defaults, including all book overrides
 */
export function resetAllSettings() {
  const pristine = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  return savePreferences(pristine);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA EXPORT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger browser file download from Blob or text
 */
function triggerFileDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export all notes as a beautifully formatted Markdown bundle
 */
export function exportNotesAsMarkdown(notes = []) {
  const timestamp = new Date().toISOString().split('T')[0];
  let markdown = `# Aks (अक्स) — Notes & Revision Notebook Export\n`;
  markdown += `*Generated on ${new Date().toLocaleString()}*\n\n`;
  markdown += `Total Notes: ${notes.length}\n\n---\n\n`;

  if (notes.length === 0) {
    markdown += `*No notes saved in your notebook yet.*\n`;
  } else {
    notes.forEach((note, index) => {
      markdown += `## ${index + 1}. ${note.title || 'Untitled Note'}\n`;
      markdown += `- **Volume**: ${note.bookTitle || 'General Sanctuary'}\n`;
      if (note.page) markdown += `- **Page**: ${note.page}\n`;
      if (note.category) markdown += `- **Category**: ${note.category}\n`;
      markdown += `- **Created**: ${note.createdAt ? new Date(note.createdAt).toLocaleDateString() : 'N/A'}\n`;
      markdown += `- **Last Modified**: ${note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : 'N/A'}\n\n`;
      markdown += `${note.content || note.text || ''}\n\n`;
      markdown += `---\n\n`;
    });
  }

  triggerFileDownload(`aks-sanctuary-notes-${timestamp}.md`, markdown, 'text/markdown;charset=utf-8');
}

/**
 * Export all notes as raw JSON for backup or programmatic migration
 */
export function exportNotesAsJson(notes = []) {
  const timestamp = new Date().toISOString().split('T')[0];
  const payload = {
    app: 'Aks (अक्स) — A Reflection of You',
    version: CURRENT_SETTINGS_VERSION,
    exportDate: new Date().toISOString(),
    dataType: 'notes',
    count: notes.length,
    notes,
  };
  triggerFileDownload(
    `aks-notes-export-${timestamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
}

/**
 * Export all bookmarks across books as JSON
 */
export function exportBookmarksAsJson(books = []) {
  const timestamp = new Date().toISOString().split('T')[0];
  const allBookmarks = [];

  books.forEach((b) => {
    if (Array.isArray(b.bookmarks) && b.bookmarks.length > 0) {
      b.bookmarks.forEach((bm) => {
        allBookmarks.push({
          bookId: b.id,
          bookTitle: b.title,
          author: b.author,
          ...bm,
        });
      });
    }
  });

  const payload = {
    app: 'Aks (अक्स) — A Reflection of You',
    version: CURRENT_SETTINGS_VERSION,
    exportDate: new Date().toISOString(),
    dataType: 'bookmarks',
    totalCount: allBookmarks.length,
    bookmarks: allBookmarks,
  };

  triggerFileDownload(
    `aks-bookmarks-export-${timestamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
}

/**
 * Export library catalog metadata (without large PDF blobs)
 */
export function exportLibraryMetadata(books = []) {
  const timestamp = new Date().toISOString().split('T')[0];
  const catalog = books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    category: b.category,
    format: b.format,
    totalPages: b.totalPages,
    currentPage: b.currentPage,
    readingProgress: b.totalPages ? Math.round((b.currentPage / b.totalPages) * 100) : 0,
    status: b.status,
    dateAdded: b.dateAdded,
    lastOpened: b.lastOpened,
    bookmarksCount: Array.isArray(b.bookmarks) ? b.bookmarks.length : 0,
    isUserImported: !!b.isUserImported,
  }));

  const payload = {
    app: 'Aks (अक्स) — A Reflection of You',
    version: CURRENT_SETTINGS_VERSION,
    exportDate: new Date().toISOString(),
    dataType: 'library-metadata',
    totalVolumes: catalog.length,
    catalog,
  };

  triggerFileDownload(
    `aks-library-catalog-${timestamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
}
