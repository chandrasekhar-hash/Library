/**
 * Centralized API client for Aks (अक्स) — A Reflection of You
 *
 * Implements:
 * - Dynamic base URL from Vite environment variables (VITE_API_BASE_URL)
 * - Automatic credentials: 'include' for session cookies
 * - Transparent CSRF token management and retry on token expiration
 * - Centralized response parsing, error formatting, and HTTP 401 session expiry handling
 * - Clean abstractions for Auth, Books, Files, Bookmarks, Highlights, Notes, Progress, Preferences, Assets, and Statistics
 */

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

let cachedCsrfToken = null;
let isFetchingCsrf = null;
let onUnauthorizedHandler = null;

/**
 * Register a callback for 401 Unauthorized responses (e.g. session expiration)
 */
export function setUnauthorizedHandler(handler) {
  onUnauthorizedHandler = handler;
  return () => {
    if (onUnauthorizedHandler === handler) {
      onUnauthorizedHandler = null;
    }
  };
}

/**
 * Clear cached CSRF token (e.g. on logout or login)
 */
export function clearCsrfToken() {
  cachedCsrfToken = null;
  isFetchingCsrf = null;
}

/**
 * Retrieve a fresh CSRF token from GET /api/auth/csrf
 * @returns {Promise<string>}
 */
export async function fetchCsrfToken(forceRefresh = false) {
  if (cachedCsrfToken && !forceRefresh) {
    return cachedCsrfToken;
  }

  if (isFetchingCsrf && !forceRefresh) {
    return isFetchingCsrf;
  }

  isFetchingCsrf = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/csrf`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Unable to connect to Aks. Please check your connection and try again.');
      }

      const data = await response.json();
      cachedCsrfToken = data.csrfToken;
      return cachedCsrfToken;
    } catch (err) {
      cachedCsrfToken = null;
      throw err;
    } finally {
      isFetchingCsrf = null;
    }
  })();

  return isFetchingCsrf;
}

/**
 * Centralized fetch wrapper with credentials, CSRF injection, and error formatting
 * @param {string} endpoint
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  // Add credentials by default
  const config = {
    ...options,
    method,
    credentials: options.credentials || 'include',
  };

  // Add CSRF token for mutating requests
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (isMutating && !headers.has('X-CSRF-Token') && !headers.has('x-csrf-token')) {
    try {
      const token = await fetchCsrfToken();
      if (token) {
        headers.set('X-CSRF-Token', token);
      }
    } catch (csrfErr) {
      console.warn('[API] Warning: Could not pre-fetch CSRF token:', csrfErr);
    }
  }

  // Set default JSON content-type if body is a string and not FormData
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  config.headers = headers;

  let response;
  try {
    response = await fetch(url, config);
  } catch (netErr) {
    const error = new Error('Unable to connect to Aks. Please check your connection and try again.');
    error.isNetworkError = true;
    error.statusCode = 0;
    error.status = 0;
    error.originalError = netErr;
    throw error;
  }

  // Handle CSRF retry if token expired (HTTP 403 with CSRF error code)
  if (response.status === 403 && isMutating && !options._isCsrfRetry) {
    try {
      const cloned = response.clone();
      const errJson = await cloned.json();
      if (
        errJson?.error?.code === 'INVALID_CSRF_TOKEN' ||
        errJson?.error?.code === 'CSRF_TOKEN_MISSING' ||
        errJson?.error?.code === 'EBADCSRFTOKEN'
      ) {
        // Fetch fresh token and retry once
        const freshToken = await fetchCsrfToken(true);
        headers.set('X-CSRF-Token', freshToken);
        return apiRequest(endpoint, {
          ...options,
          headers,
          _isCsrfRetry: true,
        });
      }
    } catch (_) {
      // Pass through to standard error handling
    }
  }

  // Handle 401 Unauthorized
  if (response.status === 401) {
    if (
      onUnauthorizedHandler &&
      !endpoint.includes('/api/auth/login') &&
      !endpoint.includes('/api/auth/me')
    ) {
      onUnauthorizedHandler();
    }
  }

  // Parse JSON response or handle empty body
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const message =
      (typeof data === 'object' && (data?.error?.message || data?.message)) ||
      (typeof data === 'string' && data) ||
      `Request failed with status ${response.status}`;

    const apiError = new Error(message);
    apiError.status = response.status;
    apiError.statusCode = response.status;
    apiError.code = typeof data === 'object' ? data?.error?.code : undefined;
    apiError.details = typeof data === 'object' ? data?.error?.details : undefined;
    apiError.data = data;
    throw apiError;
  }

  return data;
}

// ── Auth APIs ─────────────────────────────────────────────────────────────
export const authApi = {
  getCsrfToken: () => fetchCsrfToken(),
  
  register: async ({ email, password, name, mobileNumber, rememberMe = true }) => {
    clearCsrfToken();
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, mobileNumber, rememberMe }),
    });
    if (data?.csrfToken) {
      cachedCsrfToken = data.csrfToken;
    }
    return data;
  },

  login: async ({ email, password, rememberMe = true }) => {
    clearCsrfToken();
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe }),
    });
    if (data?.csrfToken) {
      cachedCsrfToken = data.csrfToken;
    }
    return data;
  },

  verifyRecovery: async ({ email, mobileNumber }) => {
    return apiRequest('/api/auth/recovery/verify', {
      method: 'POST',
      body: JSON.stringify({ email, mobileNumber }),
    });
  },

  resetPassword: async ({ recoveryToken, newPassword, confirmPassword }) => {
    return apiRequest('/api/auth/recovery/reset', {
      method: 'POST',
      body: JSON.stringify({ recoveryToken, newPassword, confirmPassword }),
    });
  },

  updateProfile: async ({ mobileNumber }) => {
    return apiRequest('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ mobileNumber }),
    });
  },

  getCurrentUser: async () => {
    const data = await apiRequest('/api/auth/me', { method: 'GET' });
    return data?.user || data;
  },

  logout: async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      clearCsrfToken();
    }
  },

  getGoogleAuthStatus: async () => {
    return apiRequest('/api/auth/google/status', { method: 'GET' });
  },

  getGoogleAuthUrl: () => {
    return `${API_BASE_URL}/api/auth/google`;
  },
};

// ── Books & PDF Files ─────────────────────────────────────────────────────
export const booksApi = {
  listBooks: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.category) query.set('category', params.category);
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    const qs = query.toString();
    return apiRequest(`/api/books${qs ? `?${qs}` : ''}`);
  },

  getBook: async (bookId) => {
    return apiRequest(`/api/books/${bookId}`);
  },

  createBook: async (bookData) => {
    return apiRequest('/api/books', {
      method: 'POST',
      body: JSON.stringify(bookData),
    });
  },

  updateBook: async (bookId, updates) => {
    return apiRequest(`/api/books/${bookId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  deleteBook: async (bookId) => {
    return apiRequest(`/api/books/${bookId}`, {
      method: 'DELETE',
    });
  },

  uploadBookFile: async (bookId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest(`/api/books/${bookId}/file`, {
      method: 'POST',
      body: formData,
    });
  },

  getBookFileUrl: (bookId) => {
    return `${API_BASE_URL}/api/books/${bookId}/file`;
  },

  uploadBookCover: async (bookId, coverBlob, type = 'custom', page = null, placement = 'right') => {
    const formData = new FormData();
    formData.append('file', coverBlob, `${type}-cover.jpg`);
    formData.append('type', type);
    if (page !== null && page !== undefined) {
      formData.append('page', String(page));
    }
    if (placement) {
      formData.append('placement', placement);
    }
    return apiRequest(`/api/books/${bookId}/cover`, {
      method: 'POST',
      body: formData,
    });
  },

  updateCoverPlacement: async (bookId, placement) => {
    return apiRequest(`/api/books/${bookId}/cover/placement`, {
      method: 'PATCH',
      body: JSON.stringify({ placement }),
    });
  },

  resetBookCover: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/cover/reset`, {
      method: 'POST',
    });
  },

  searchBook: async (bookId, params = {}, options = {}) => {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    if (params.mode) query.set('mode', params.mode);
    const qs = query.toString();
    return apiRequest(`/api/books/${bookId}/search${qs ? `?${qs}` : ''}`, options);
  },

  getOcrStatus: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/ocr/status`);
  },

  requestOcr: async (bookId, data = {}) => {
    return apiRequest(`/api/books/${bookId}/ocr`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  retryOcr: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/ocr/retry`, {
      method: 'POST',
    });
  },

  cancelOcr: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/ocr/cancel`, {
      method: 'POST',
    });
  },

  // Library-wide indexing management
  getLibraryIndexingStatus: async () => {
    return apiRequest('/api/ocr/library/status');
  },

  startLibraryIndexing: async (options = {}) => {
    return apiRequest('/api/ocr/library/start', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  pauseLibraryIndexing: async () => {
    return apiRequest('/api/ocr/library/pause', {
      method: 'POST',
    });
  },

  resumeLibraryIndexing: async () => {
    return apiRequest('/api/ocr/library/resume', {
      method: 'POST',
    });
  },

  retryFailedLibraryIndexing: async () => {
    return apiRequest('/api/ocr/library/retry-failed', {
      method: 'POST',
    });
  },

  getBookCoverUrl: (bookId, coverUpdatedAt, type) => {
    if (!bookId) return null;
    let url = `${API_BASE_URL}/api/books/${bookId}/cover`;
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (coverUpdatedAt) params.set('t', String(coverUpdatedAt));
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  },
};

// ── Reading Progress ──────────────────────────────────────────────────────
export const progressApi = {
  getProgress: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/progress`);
  },

  updateProgress: async (bookId, progressData) => {
    return apiRequest(`/api/books/${bookId}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progressData),
    });
  },
};

// ── Bookmarks ─────────────────────────────────────────────────────────────
export const bookmarksApi = {
  listBookmarks: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/bookmarks`);
  },

  createBookmark: async (bookId, bookmarkData) => {
    return apiRequest(`/api/books/${bookId}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify(bookmarkData),
    });
  },

  updateBookmark: async (bookmarkId, updates) => {
    return apiRequest(`/api/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  deleteBookmark: async (bookmarkId) => {
    return apiRequest(`/api/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    });
  },
};

// ── Highlights ────────────────────────────────────────────────────────────
export const highlightsApi = {
  listHighlights: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/highlights`);
  },

  createHighlight: async (bookId, highlightData) => {
    return apiRequest(`/api/books/${bookId}/highlights`, {
      method: 'POST',
      body: JSON.stringify(highlightData),
    });
  },

  updateHighlight: async (highlightId, updates) => {
    return apiRequest(`/api/highlights/${highlightId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  deleteHighlight: async (highlightId) => {
    return apiRequest(`/api/highlights/${highlightId}`, {
      method: 'DELETE',
    });
  },
};

// ── Notes ─────────────────────────────────────────────────────────────────
export const notesApi = {
  listNotes: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.bookId) query.set('bookId', params.bookId);
    if (params.type) query.set('type', params.type);
    if (params.category) query.set('category', params.category);
    if (params.sectionId) query.set('sectionId', params.sectionId);
    if (params.isPinned !== undefined) query.set('isPinned', String(params.isPinned));
    if (params.date) query.set('date', params.date);
    if (params.search) query.set('search', params.search);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    const qs = query.toString();
    return apiRequest(`/api/notes${qs ? `?${qs}` : ''}`);
  },

  getNote: async (noteId) => {
    return apiRequest(`/api/notes/${noteId}`);
  },

  createNote: async (noteData) => {
    return apiRequest('/api/notes', {
      method: 'POST',
      body: JSON.stringify(noteData),
    });
  },

  updateNote: async (noteId, updates) => {
    return apiRequest(`/api/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  deleteNote: async (noteId) => {
    return apiRequest(`/api/notes/${noteId}`, {
      method: 'DELETE',
    });
  },

  // ── Sections & Notebooks API ──────────────────────────────────────────────
  listSections: async () => {
    return apiRequest('/api/notes/sections');
  },

  createSection: async (sectionData) => {
    return apiRequest('/api/notes/sections', {
      method: 'POST',
      body: JSON.stringify(sectionData),
    });
  },

  updateSection: async (sectionId, updates) => {
    return apiRequest(`/api/notes/sections/${sectionId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  deleteSection: async (sectionId) => {
    return apiRequest(`/api/notes/sections/${sectionId}`, {
      method: 'DELETE',
    });
  },

  reorderSections: async (sectionIds) => {
    return apiRequest('/api/notes/sections/reorder', {
      method: 'POST',
      body: JSON.stringify({ sectionIds }),
    });
  },
};

// ── Preferences & Assets ──────────────────────────────────────────────────
export const preferencesApi = {
  getGlobalPreferences: async () => {
    return apiRequest('/api/preferences');
  },

  updateGlobalPreferences: async (preferences) => {
    return apiRequest('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify(preferences),
    });
  },

  getBookPreferences: async (bookId) => {
    return apiRequest(`/api/books/${bookId}/preferences`);
  },

  updateBookPreferences: async (bookId, preferences) => {
    return apiRequest(`/api/books/${bookId}/preferences`, {
      method: 'PATCH',
      body: JSON.stringify(preferences),
    });
  },

  listAssets: async (assetType) => {
    const qs = assetType ? `?type=${encodeURIComponent(assetType)}` : '';
    return apiRequest(`/api/assets${qs}`);
  },

  uploadAsset: async (file, assetType, metadata = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('assetType', assetType);
    if (Object.keys(metadata).length > 0) {
      formData.append('metadata', JSON.stringify(metadata));
    }
    return apiRequest('/api/assets/backgrounds', {
      method: 'POST',
      body: formData,
    });
  },

  deleteAsset: async (assetId) => {
    return apiRequest(`/api/assets/${assetId}`, {
      method: 'DELETE',
    });
  },

  getAssetFileUrl: (assetId) => {
    return `${API_BASE_URL}/api/assets/${assetId}/file`;
  },
};

// ── Reading Sessions & Study Statistics ───────────────────────────────────
export const statisticsApi = {
  getStatistics: async () => {
    return apiRequest('/api/statistics');
  },

  listSessions: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.bookId) query.set('bookId', params.bookId);
    if (params.includeHistorical !== undefined) query.set('includeHistorical', String(params.includeHistorical));
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    const qs = query.toString();
    return apiRequest(`/api/statistics/sessions${qs ? `?${qs}` : ''}`);
  },

  startSession: async (bookId, { idempotencyKey } = {}) => {
    const key = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`);
    return apiRequest(`/api/books/${bookId}/sessions/start`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: key }),
    });
  },

  finishSession: async (bookId, sessionId) => {
    return apiRequest(`/api/books/${bookId}/sessions/${sessionId}/finish`, {
      method: 'POST',
    });
  },

  getActiveSession: async (bookId) => {
    const url = bookId ? `/api/books/${bookId}/sessions/active` : '/api/books/dummy/sessions/active';
    return apiRequest(url);
  },

  resetStudyTime: async () => {
    return apiRequest('/api/statistics/reset', {
      method: 'POST',
    });
  },
};

export const libraryIndexingApi = {
  getStatus: () => booksApi.getLibraryIndexingStatus(),
  start: (options) => booksApi.startLibraryIndexing(options),
  pause: () => booksApi.pauseLibraryIndexing(),
  resume: () => booksApi.resumeLibraryIndexing(),
  retryFailed: () => booksApi.retryFailedLibraryIndexing(),
};

// ── Linked Accounts & Owner Relationships (Phase ACCOUNT-1A) ─────────────
export const accountRelationshipsApi = {
  listLinkedUsers: async () => {
    return apiRequest('/api/account/relationships');
  },

  linkUser: async ({ targetEmail, targetUserId }) => {
    return apiRequest('/api/account/relationships', {
      method: 'POST',
      body: JSON.stringify({ targetEmail, targetUserId }),
    });
  },

  revokeRelationship: async (targetUserId) => {
    return apiRequest(`/api/account/relationships/${targetUserId}`, {
      method: 'DELETE',
    });
  },
};

// ── Owner-Authorized Account Access (Phase ACCOUNT-1B) ───────────────────
export const ownerAccessApi = {
  startOwnerAccess: async (targetUserId) => {
    return apiRequest('/api/account/owner-access/start', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    });
  },

  getCurrentOwnerAccess: async () => {
    return apiRequest('/api/account/owner-access/current');
  },

  exitOwnerAccess: async () => {
    return apiRequest('/api/account/owner-access/exit', {
      method: 'POST',
    });
  },

  getAccessHistory: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    const qs = query.toString();
    return apiRequest(`/api/account/owner-access/history${qs ? `?${qs}` : ''}`);
  },
};
