/**
 * sanctuaryDataService.js — Unified Data Bridge for Aks (अक्स)
 *
 * Implements strict separation between:
 * 1. Authenticated mode (PostgreSQL backend via api.js)
 * 2. Guest mode (local IndexedDB & localStorage via db.js and preferencesService.js)
 *
 * Guarantees:
 * - Guest records in IndexedDB are NEVER deleted, mutated, or silently claimed by an account.
 * - Authenticated operations communicate directly with the verified server APIs.
 * - Automatic fallback and error handling if network or server is temporarily unreachable.
 * - Transparent mapping of book, note, bookmark, highlight, preference, and study session models.
 */

import {
  authApi,
  booksApi,
  bookmarksApi,
  highlightsApi,
  notesApi,
  progressApi,
  preferencesApi,
  statisticsApi,
} from './api.js';

import {
  getAllBooks as getLocalBooks,
  getBook as getLocalBook,
  saveBook as saveLocalBook,
  updateBook as updateLocalBook,
  deleteBook as deleteLocalBook,
  getAllNotes as getLocalNotes,
  saveNote as saveLocalNote,
  deleteNote as deleteLocalNote,
  saveHighlight as saveLocalHighlight,
  deleteHighlight as deleteLocalHighlight,
} from './db.js';

import {
  loadPreferences as getLocalPreferences,
  savePreferences as saveLocalPreferences,
  DEFAULT_PREFERENCES,
} from './preferencesService.js';

import {
  getTotalStudyTime as getLocalStudyTime,
  addStudyTime as addLocalStudyTime,
  resetStudyTime as resetLocalStudyTime,
} from './studyTimeService.js';

// In-memory current auth state
let currentAuthUser = null;
const authChangeListeners = new Set();
const dataChangeListeners = new Set();

export function onAuthStateChanged(callback) {
  authChangeListeners.add(callback);
  return () => authChangeListeners.delete(callback);
}

export function onDataChanged(callback) {
  dataChangeListeners.add(callback);
  return () => dataChangeListeners.delete(callback);
}

function notifyDataChanged(entityType, payload) {
  dataChangeListeners.forEach((fn) => {
    try {
      fn(entityType, payload);
    } catch (e) {
      console.warn('[sanctuaryDataService] Listener error:', e);
    }
  });
}

/**
 * Configure current authenticated user or null for guest mode
 */
export function setSanctuaryAuthUser(user) {
  currentAuthUser = user || null;
  authChangeListeners.forEach((fn) => {
    try {
      fn(currentAuthUser);
    } catch (e) {
      console.warn('[sanctuaryDataService] Auth listener error:', e);
    }
  });
}

export function getSanctuaryAuthUser() {
  return currentAuthUser;
}

export function isAuthenticated() {
  return Boolean(currentAuthUser && currentAuthUser.id);
}

// ── Books Service ─────────────────────────────────────────────────────────

export async function fetchAllBooks() {
  if (isAuthenticated()) {
    try {
      const res = await booksApi.listBooks();
      const rawBooks = Array.isArray(res?.books) ? res.books : [];
      
      const booksWithBookmarks = await Promise.all(
        rawBooks.map(async (b) => {
          let bms = [];
          if (b._count?.bookmarks > 0) {
            try {
              const bmRes = await bookmarksApi.listBookmarks(b.id);
              bms = Array.isArray(bmRes?.bookmarks) ? bmRes.bookmarks : [];
            } catch (_) {}
          }
          const coverUpdatedAt = b.colorScheme?.coverUpdatedAt || null;
          const hasCover = Boolean(coverUpdatedAt || b.colorScheme?.defaultCoverPage || b.colorScheme?.hasCustomCover);
          const coverUrl = hasCover ? booksApi.getBookCoverUrl(b.id, coverUpdatedAt) : null;

          return {
            ...b,
            isBackendBook: true,
            currentPage: b.readingProgress?.currentPage || 1,
            progress: b.readingProgress?.progressPercent || 0,
            lastOpened: b.readingProgress?.lastOpenedAt
              ? new Date(b.readingProgress.lastOpenedAt).toLocaleDateString()
              : 'Never',
            lastOpenedTimestamp: b.readingProgress?.lastOpenedAt
              ? new Date(b.readingProgress.lastOpenedAt).getTime()
              : 0,
            bookmarks: bms,
            bookmarksCount: b._count?.bookmarks || bms.length,
            notesCount: b._count?.notes || 0,
            highlightsCount: b._count?.highlights || 0,
            fileUrl: booksApi.getBookFileUrl(b.id),
            coverUrl,
            coverPlacement: b.colorScheme?.coverPlacement || b.coverPlacement || 'right',
            hasCustomCover: Boolean(b.colorScheme?.hasCustomCover),
            customCoverPage: b.colorScheme?.customCoverPage || null,
            defaultCoverPage: b.colorScheme?.defaultCoverPage || 1,
            coverTheme: {
              ...(b.colorScheme || {}),
              coverUrl,
              coverPlacement: b.colorScheme?.coverPlacement || b.coverPlacement || 'right',
            },
          };
        })
      );

      return booksWithBookmarks;
    } catch (err) {
      console.error('[sanctuaryDataService] Failed to load server books:', err);
      throw err;
    }
  }

  // Guest Mode: load from local IndexedDB
  return getLocalBooks();
}

export async function createNewBook(bookPayload, file) {
  if (isAuthenticated()) {
    // 0. Reuse existing book/file record if this user already uploaded this file
    const targetHash = bookPayload.fileHash;
    let existingMatch = null;
    if (targetHash) {
      try {
        const existingRes = await booksApi.listBooks();
        const serverBooks = Array.isArray(existingRes?.books) ? existingRes.books : [];
        existingMatch = serverBooks.find(
          (b) => b.file?.fileSha256 && b.file.fileSha256.toLowerCase() === targetHash.toLowerCase()
        );
      } catch (e) {
        console.warn('[sanctuaryDataService] Could not check existing books:', e);
      }
    }

    if (existingMatch) {
      // Re-use existing book record — do not duplicate PDF file or book
      if (bookPayload.currentPage && bookPayload.currentPage > 1) {
        try {
          await progressApi.updateProgress(existingMatch.id, {
            currentPage: bookPayload.currentPage,
            totalPages: existingMatch.totalPages || bookPayload.totalPages || 1,
          });
        } catch (_) {}
      }

      const finalized = {
        ...existingMatch,
        isBackendBook: true,
        currentPage: bookPayload.currentPage || existingMatch.readingProgress?.currentPage || 1,
        progress: existingMatch.readingProgress?.progressPercent || 0,
        fileUrl: booksApi.getBookFileUrl(existingMatch.id),
        bookmarksCount: existingMatch._count?.bookmarks || 0,
        notesCount: existingMatch._count?.notes || 0,
        highlightsCount: existingMatch._count?.highlights || 0,
        bookmarks: bookPayload.bookmarks || [],
        notes: bookPayload.notes || [],
        highlights: bookPayload.highlights || [],
        blob: file || bookPayload.blob,
      };

      notifyDataChanged('books', { action: 'create', book: finalized });
      return finalized;
    }

    // 1. Create book record on backend
    const bookData = {
      title: bookPayload.title || file?.name || 'Untitled Book',
      author: bookPayload.author || 'Personal Document',
      category: bookPayload.category || 'General',
      format: 'PDF',
      totalPages: bookPayload.totalPages || 1,
      colorScheme: bookPayload.coverTheme || null,
      sourceId: bookPayload.sourceId || (typeof bookPayload.id === 'string' ? bookPayload.id : null),
    };

    const res = await booksApi.createBook(bookData);
    const serverBook = res.book;

    // 2. Upload PDF file if provided and not already uploaded (reuse check)
    if (file && (!res.isExisting || !serverBook.file)) {
      try {
        await booksApi.uploadBookFile(serverBook.id, file);
      } catch (uploadErr) {
        console.error('[sanctuaryDataService] PDF upload failed:', uploadErr);
        // Clean up orphaned book record so no corrupted record remains (only if newly created)
        if (!res.isExisting) {
          try {
            await booksApi.deleteBook(serverBook.id);
          } catch (_) {}
        }
        throw new Error(uploadErr.message || 'Failed to upload PDF file to server.');
      }
    }

    // 2b. Upload cover thumbnail if provided
    let latestServerBook = serverBook;
    const coverBlobToUpload = bookPayload.coverBlob || bookPayload.defaultCoverBlob;
    if (coverBlobToUpload) {
      try {
        const coverRes = await booksApi.uploadBookCover(serverBook.id, coverBlobToUpload, 'default', 1);
        if (coverRes?.book) {
          latestServerBook = coverRes.book;
        }
      } catch (coverErr) {
        console.warn('[sanctuaryDataService] Failed to upload default cover on create:', coverErr);
      }
    }

    // 3. Sync reading progress if page > 1
    if (bookPayload.currentPage && bookPayload.currentPage > 1) {
      try {
        await progressApi.updateProgress(serverBook.id, {
          currentPage: bookPayload.currentPage,
          totalPages: bookPayload.totalPages || 1,
        });
      } catch (err) {
        console.warn('[sanctuaryDataService] Failed to sync progress on create:', err);
      }
    }

    // 4. Sync bookmarks if present
    const savedBookmarks = [];
    if (Array.isArray(bookPayload.bookmarks) && bookPayload.bookmarks.length > 0) {
      for (const bm of bookPayload.bookmarks) {
        try {
          const createdBm = await bookmarksApi.createBookmark(serverBook.id, {
            page: bm.page,
            label: bm.label || `Page ${bm.page}`,
            color: bm.color || 'gold',
          });
          savedBookmarks.push(createdBm.bookmark || createdBm);
        } catch (err) {
          console.warn('[sanctuaryDataService] Failed to sync bookmark on create:', err);
        }
      }
    }

    // 5. Sync notes if present
    if (Array.isArray(bookPayload.notes) && bookPayload.notes.length > 0) {
      for (const n of bookPayload.notes) {
        try {
          await notesApi.createNote({
            bookId: serverBook.id,
            title: n.title || 'Untitled Note',
            content: n.content || '',
            page: n.page || 1,
            color: n.color || 'default',
          });
        } catch (err) {
          console.warn('[sanctuaryDataService] Failed to sync note on create:', err);
        }
      }
    }

    // 6. Sync highlights if present
    if (Array.isArray(bookPayload.highlights) && bookPayload.highlights.length > 0) {
      for (const hl of bookPayload.highlights) {
        try {
          await highlightsApi.createHighlight(serverBook.id, {
            page: hl.page,
            text: hl.text || '',
            color: hl.color || 'gold',
            rects: hl.rects || [],
          });
        } catch (err) {
          console.warn('[sanctuaryDataService] Failed to sync highlight on create:', err);
        }
      }
    }

    const currPage = bookPayload.currentPage || 1;
    const totPages = bookPayload.totalPages || 1;
    const coverUpdatedAt = latestServerBook.colorScheme?.coverUpdatedAt || Date.now();
    const coverUrl = booksApi.getBookCoverUrl(latestServerBook.id, coverUpdatedAt);
    const finalized = {
      ...latestServerBook,
      isBackendBook: true,
      currentPage: currPage,
      progress: Math.round((currPage / totPages) * 100),
      fileUrl: booksApi.getBookFileUrl(latestServerBook.id),
      coverUrl: coverBlobToUpload ? coverUrl : (latestServerBook.colorScheme?.coverUpdatedAt ? coverUrl : null),
      coverImage: bookPayload.coverImage || bookPayload.defaultCoverImage || null,
      defaultCoverImage: bookPayload.defaultCoverImage || null,
      coverPlacement: latestServerBook.colorScheme?.coverPlacement || latestServerBook.coverPlacement || bookPayload.coverPlacement || 'right',
      hasCustomCover: Boolean(latestServerBook.colorScheme?.hasCustomCover),
      customCoverPage: latestServerBook.colorScheme?.customCoverPage || null,
      defaultCoverPage: latestServerBook.colorScheme?.defaultCoverPage || 1,
      coverTheme: {
        ...(latestServerBook.colorScheme || {}),
        coverUrl: coverBlobToUpload ? coverUrl : null,
        coverPlacement: latestServerBook.colorScheme?.coverPlacement || latestServerBook.coverPlacement || bookPayload.coverPlacement || 'right',
      },
      bookmarksCount: savedBookmarks.length,
      notesCount: (bookPayload.notes || []).length,
      highlightsCount: (bookPayload.highlights || []).length,
      bookmarks: savedBookmarks,
      notes: bookPayload.notes || [],
      highlights: bookPayload.highlights || [],
      blob: file || bookPayload.blob,
      fileHash: bookPayload.fileHash,
      rawBytes: bookPayload.rawBytes,
      filename: bookPayload.filename,
    };

    notifyDataChanged('books', { action: 'create', book: finalized });
    return finalized;
  }

  // Guest Mode: save locally in IndexedDB
  const localSaved = await saveLocalBook({
    ...bookPayload,
    blob: file || bookPayload.blob,
  });
  notifyDataChanged('books', { action: 'create', book: localSaved });
  return localSaved;
}

export async function updateExistingBook(bookId, updates) {
  if (isAuthenticated()) {
    const payload = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.author !== undefined) payload.author = updates.author;
    if (updates.status !== undefined) {
      payload.status = updates.status.toUpperCase() === 'FINISHED' ? 'FINISHED' : 'IN_PROGRESS';
    }

    const res = await booksApi.updateBook(bookId, payload);
    notifyDataChanged('books', { action: 'update', bookId, updates });
    return res.book;
  }

  // Guest Mode
  const updated = await updateLocalBook(bookId, updates);
  notifyDataChanged('books', { action: 'update', bookId, updates });
  return updated;
}

export async function deleteExistingBook(bookId) {
  if (isAuthenticated()) {
    await booksApi.deleteBook(bookId);
    notifyDataChanged('books', { action: 'delete', bookId });
    return true;
  }

  // Guest Mode
  await deleteLocalBook(bookId);
  notifyDataChanged('books', { action: 'delete', bookId });
  return true;
}

// ── Reading Progress ──────────────────────────────────────────────────────

export async function saveReadingProgress(bookId, currentPage, totalPages) {
  if (isAuthenticated()) {
    try {
      const res = await progressApi.updateProgress(bookId, {
        currentPage,
        totalPages,
      });
      return res.progress;
    } catch (err) {
      console.warn('[sanctuaryDataService] Server progress update failed:', err);
    }
  }

  // Guest Mode
  return updateLocalBook(bookId, {
    currentPage,
    lastOpenedTimestamp: Date.now(),
    lastOpened: 'Just now',
    status: currentPage >= totalPages ? 'finished' : 'in-progress',
  });
}

// ── Bookmarks ─────────────────────────────────────────────────────────────

export async function fetchBookDetails(bookId) {
  if (!bookId) return null;

  if (isAuthenticated()) {
    try {
      const res = await booksApi.getBook(bookId);
      const b = res.book;
      const [bmRes, hlRes, notesRes] = await Promise.all([
        bookmarksApi.listBookmarks(bookId).catch(() => ({ bookmarks: [] })),
        highlightsApi.listHighlights(bookId).catch(() => ({ highlights: [] })),
        notesApi.listNotes({ bookId }).catch(() => ({ notes: [] })),
      ]);

      const rp = b.readingProgress || b.progress;
      return {
        id: b.id,
        title: b.title,
        author: b.author || 'Unknown Author',
        category: b.category || 'General',
        format: b.format || 'PDF',
        totalPages: b.totalPages || 1,
        currentPage: rp?.currentPage || 1,
        status: b.status ? b.status.toLowerCase().replace('_', '-') : (rp?.status ? rp.status.toLowerCase() : 'not-started'),
        progressPercentage: rp?.progressPercent ?? rp?.percentage ?? 0,
        lastOpenedTimestamp: rp?.lastOpenedAt ? new Date(rp.lastOpenedAt).getTime() : (rp?.lastReadAt ? new Date(rp.lastReadAt).getTime() : 0),
        lastOpened: rp?.lastOpenedAt ? new Date(rp.lastOpenedAt).toLocaleDateString() : 'Not started',
        isBackendBook: true,
        fileUrl: booksApi.getBookFileUrl(b.id),
        bookmarks: bmRes.bookmarks || [],
        bookmarksCount: (bmRes.bookmarks || []).length,
        highlights: hlRes.highlights || [],
        highlightsCount: (hlRes.highlights || []).length,
        notes: (notesRes.notes || []).map((n) => ({
          ...n,
          text: n.text || n.content || '',
          content: n.content || n.text || '',
          bookTitle: n.bookTitle || n.book?.title || b.title,
        })),
      };
    } catch (err) {
      console.warn('[sanctuaryDataService] Could not fetch server book details:', err);
    }
  }

  // Guest Mode
  return getLocalBook(bookId);
}

// ── Bookmarks ─────────────────────────────────────────────────────────────

export async function fetchBookBookmarks(bookId) {
  if (isAuthenticated()) {
    const res = await bookmarksApi.listBookmarks(bookId);
    return res.bookmarks || [];
  }

  // Guest Mode
  const book = await getLocalBook(bookId);
  return book?.bookmarks || [];
}

export async function addBookBookmark(bookId, bookmarkData) {
  if (isAuthenticated()) {
    const res = await bookmarksApi.createBookmark(bookId, {
      page: bookmarkData.page,
      label: bookmarkData.label || `Page ${bookmarkData.page}`,
      color: bookmarkData.color || 'gold',
    });
    notifyDataChanged('bookmarks', { action: 'add', bookId, bookmark: res.bookmark });
    return res.bookmark;
  }

  // Guest Mode
  const localBm = {
    id: `bm-${bookId}-p${bookmarkData.page}-${Date.now()}`,
    bookId,
    page: bookmarkData.page,
    label: bookmarkData.label || `Page ${bookmarkData.page}`,
    createdAt: new Date().toISOString(),
    color: bookmarkData.color || 'gold',
  };
  const book = await getLocalBook(bookId);
  if (book) {
    const currentList = Array.isArray(book.bookmarks) ? book.bookmarks : [];
    const updated = [...currentList.filter((b) => b.page !== bookmarkData.page), localBm];
    await updateLocalBook(bookId, { bookmarks: updated, bookmarksCount: updated.length });
  }
  notifyDataChanged('bookmarks', { action: 'add', bookId, bookmark: localBm });
  return localBm;
}

export async function removeBookBookmark(bookId, bookmarkId) {
  if (isAuthenticated()) {
    await bookmarksApi.deleteBookmark(bookmarkId);
    notifyDataChanged('bookmarks', { action: 'delete', bookId, bookmarkId });
    return true;
  }

  // Guest Mode
  const book = await getLocalBook(bookId);
  if (book) {
    const currentList = Array.isArray(book.bookmarks) ? book.bookmarks : [];
    const updated = currentList.filter((b) => b.id !== bookmarkId);
    await updateLocalBook(bookId, { bookmarks: updated, bookmarksCount: updated.length });
  }
  notifyDataChanged('bookmarks', { action: 'delete', bookId, bookmarkId });
  return true;
}

// ── Highlights ────────────────────────────────────────────────────────────

export async function fetchBookHighlights(bookId) {
  if (isAuthenticated()) {
    const res = await highlightsApi.listHighlights(bookId);
    return res.highlights || [];
  }

  // Guest Mode
  const book = await getLocalBooks().then((books) => books.find((b) => b.id === bookId));
  return book?.highlights || [];
}

export async function addBookHighlight(bookId, highlightData) {
  if (isAuthenticated()) {
    const res = await highlightsApi.createHighlight(bookId, {
      page: highlightData.page,
      text: highlightData.text,
      color: highlightData.color || 'gold',
      positionJson: highlightData.positionJson || highlightData.bounds || null,
    });
    notifyDataChanged('highlights', { action: 'add', bookId, highlight: res.highlight });
    return res.highlight;
  }

  // Guest Mode
  const res = await saveLocalHighlight(bookId, highlightData);
  notifyDataChanged('highlights', { action: 'add', bookId, highlight: highlightData });
  return res;
}

export async function removeBookHighlight(bookId, highlightId) {
  if (isAuthenticated()) {
    await highlightsApi.deleteHighlight(highlightId);
    notifyDataChanged('highlights', { action: 'delete', bookId, highlightId });
    return true;
  }

  // Guest Mode
  const res = await deleteLocalHighlight(bookId, highlightId);
  notifyDataChanged('highlights', { action: 'delete', bookId, highlightId });
  return res;
}

export { removeBookHighlight as deleteExistingHighlight };

// ── Notes ─────────────────────────────────────────────────────────────────

export async function fetchAllNotes(params = {}) {
  if (isAuthenticated()) {
    const res = await notesApi.listNotes(params);
    const notes = Array.isArray(res?.notes) ? res.notes : [];
    return notes.map((n) => ({
      ...n,
      bookTitle: n.bookTitle || n.book?.title || null,
    }));
  }

  // Guest Mode
  return getLocalNotes();
}

export async function saveNewNote(noteData) {
  if (isAuthenticated()) {
    const isUuid = typeof noteData.bookId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(noteData.bookId);

    const content = noteData.content !== undefined ? noteData.content : (noteData.text || '');
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
    const defaultTitle = firstLine ? firstLine.slice(0, 48) : 'Untitled Reflection';

    const payload = {
      bookId: isUuid ? noteData.bookId : null,
      title: (noteData.title && String(noteData.title).trim()) || defaultTitle,
      content,
      richContent: noteData.richContent || null,
      page: typeof noteData.page === 'number' && !isNaN(noteData.page) && noteData.page > 0 ? noteData.page : null,
      category: noteData.category || 'Reflection',
      type: isUuid ? 'BOOK' : 'STANDALONE',
      sectionId: noteData.sectionId || null,
      isPinned: Boolean(noteData.isPinned),
      journalDate: noteData.journalDate || null,
      appearance: noteData.appearance || 'classic-paper',
      typography: noteData.typography || null,
    };

    const res = await notesApi.createNote(payload);
    const normalized = {
      ...res.note,
      text: res.note.content,
    };
    notifyDataChanged('notes', { action: 'create', note: normalized });
    return normalized;
  }

  // Guest Mode
  const localSaved = await saveLocalNote(noteData);
  notifyDataChanged('notes', { action: 'create', note: localSaved });
  return localSaved;
}

export async function updateExistingNote(noteId, updates) {
  if (isAuthenticated()) {
    const payload = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.content !== undefined) payload.content = updates.content;
    else if (updates.text !== undefined) payload.content = updates.text;
    if (updates.richContent !== undefined) payload.richContent = updates.richContent;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.page !== undefined) payload.page = updates.page;
    if (updates.sectionId !== undefined) payload.sectionId = updates.sectionId;
    if (updates.isPinned !== undefined) payload.isPinned = updates.isPinned;
    if (updates.journalDate !== undefined) payload.journalDate = updates.journalDate;
    if (updates.appearance !== undefined) payload.appearance = updates.appearance;
    if (updates.typography !== undefined) payload.typography = updates.typography;

    const res = await notesApi.updateNote(noteId, payload);
    const normalized = { ...res.note, text: res.note.content };
    notifyDataChanged('notes', { action: 'update', noteId, updates: normalized });
    return normalized;
  }

  // Guest Mode
  const localSaved = await saveLocalNote({ id: noteId, ...updates });
  notifyDataChanged('notes', { action: 'update', noteId, updates });
  return localSaved;
}

export async function deleteExistingNote(noteId) {
  if (isAuthenticated()) {
    await notesApi.deleteNote(noteId);
    notifyDataChanged('notes', { action: 'delete', noteId });
    return true;
  }

  // Guest Mode
  await deleteLocalNote(noteId);
  notifyDataChanged('notes', { action: 'delete', noteId });
  return true;
}

// ── Note Sections & Notebooks ─────────────────────────────────────────────

const DEFAULT_GUEST_SECTIONS = [
  { id: 'sec-daily-journal', name: 'Daily Journal', color: '#e7c18a', icon: 'calendar', order: 0 },
  { id: 'sec-personal', name: 'Personal', color: '#67b8a2', icon: 'user', order: 1 },
  { id: 'sec-ideas', name: 'Ideas', color: '#f59e0b', icon: 'lightbulb', order: 2 },
  { id: 'sec-work', name: 'Work', color: '#60a5fa', icon: 'briefcase', order: 3 },
];

function getGuestSections() {
  try {
    const raw = localStorage.getItem('FolioSanctuary_GuestSections');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  localStorage.setItem('FolioSanctuary_GuestSections', JSON.stringify(DEFAULT_GUEST_SECTIONS));
  return DEFAULT_GUEST_SECTIONS;
}

function setGuestSections(sections) {
  try {
    localStorage.setItem('FolioSanctuary_GuestSections', JSON.stringify(sections));
  } catch (_) {}
}

export async function fetchNoteSections() {
  if (isAuthenticated()) {
    const res = await notesApi.listSections();
    return Array.isArray(res?.sections) ? res.sections : [];
  }
  return getGuestSections();
}

export async function saveNewSection(sectionData) {
  if (isAuthenticated()) {
    const res = await notesApi.createSection(sectionData);
    notifyDataChanged('sections', { action: 'create', section: res.section });
    return res.section;
  }
  const current = getGuestSections();
  const newSec = {
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: sectionData.name.trim(),
    color: sectionData.color || '#e7c18a',
    icon: sectionData.icon || 'folder',
    order: current.length,
    noteCount: 0,
  };
  current.push(newSec);
  setGuestSections(current);
  notifyDataChanged('sections', { action: 'create', section: newSec });
  return newSec;
}

export async function updateExistingSection(sectionId, updates) {
  if (isAuthenticated()) {
    const res = await notesApi.updateSection(sectionId, updates);
    notifyDataChanged('sections', { action: 'update', sectionId, updates: res.section });
    return res.section;
  }
  const current = getGuestSections();
  const idx = current.findIndex((s) => s.id === sectionId);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...updates };
    setGuestSections(current);
    notifyDataChanged('sections', { action: 'update', sectionId, updates: current[idx] });
    return current[idx];
  }
  return null;
}

export async function deleteExistingSection(sectionId) {
  if (isAuthenticated()) {
    await notesApi.deleteSection(sectionId);
    notifyDataChanged('sections', { action: 'delete', sectionId });
    return true;
  }
  const current = getGuestSections().filter((s) => s.id !== sectionId);
  setGuestSections(current);
  notifyDataChanged('sections', { action: 'delete', sectionId });
  return true;
}

// ── Preferences & Background Assets ───────────────────────────────────────

export async function fetchPreferences() {
  if (isAuthenticated()) {
    try {
      const res = await preferencesApi.getGlobalPreferences();
      if (res?.preferences) {
        // Map backend schema to frontend structure
        const p = res.preferences;
        return {
          version: 1,
          global: {
            reading: p.readingConfig || DEFAULT_PREFERENCES.global.reading,
            typography: p.typographyConfig || DEFAULT_PREFERENCES.global.typography,
            annotations: p.annotationsConfig || DEFAULT_PREFERENCES.global.annotations,
            atmosphere: p.atmosphereConfig || DEFAULT_PREFERENCES.global.atmosphere,
            storage: p.storageConfig || DEFAULT_PREFERENCES.global.storage,
            theme: DEFAULT_PREFERENCES.global.theme,
          },
          bookOverrides: {},
        };
      }
    } catch (err) {
      console.warn('[sanctuaryDataService] Failed to load server preferences, using local:', err);
    }
  }

  // Guest Mode
  return getLocalPreferences();
}

export async function savePreferences(preferences) {
  if (isAuthenticated()) {
    try {
      const g = preferences.global || {};
      const payload = {
        readingConfig: g.reading,
        typographyConfig: g.typography,
        annotationsConfig: g.annotations,
        atmosphereConfig: g.atmosphere,
        storageConfig: g.storage,
      };

      await preferencesApi.updateGlobalPreferences(payload);
    } catch (err) {
      console.warn('[sanctuaryDataService] Could not persist server preferences:', err);
    }
  }

  // Always keep local preferences in sync as fallback
  return saveLocalPreferences(preferences);
}

// ── Study Statistics & Server Sessions ────────────────────────────────────

export async function fetchStudyStatistics() {
  if (isAuthenticated()) {
    try {
      const res = await statisticsApi.getStatistics();
      return res.statistics;
    } catch (err) {
      console.warn('[sanctuaryDataService] Could not fetch server statistics:', err);
    }
  }

  // Guest Mode
  const localTotal = getLocalStudyTime();
  return {
    totalStudyTimeSeconds: localTotal,
    allTimeStudyTimeSeconds: localTotal,
    totalSessionsCount: localTotal > 0 ? 1 : 0,
    allTimeSessionsCount: localTotal > 0 ? 1 : 0,
    averageSessionDurationSeconds: localTotal,
    dailyStudyTime: [],
  };
}

export async function resetStudyStatistics() {
  if (isAuthenticated()) {
    try {
      await statisticsApi.resetStudyTime();
    } catch (err) {
      console.warn('[sanctuaryDataService] Server reset failed:', err);
    }
  }

  // Guest Mode / Local Reset
  resetLocalStudyTime();
}

/**
 * Server-authoritative session controller for Reading Room
 */
class ReadingSessionManager {
  constructor() {
    this.activeBookId = null;
    this.activeSessionId = null;
    this.idempotencyKey = null;
    this.isStarting = false;
  }

  async start(bookId) {
    if (!bookId) return null;
    this.activeBookId = bookId;

    if (!isAuthenticated()) {
      // Guest mode does not start a server session
      return null;
    }

    if (this.isStarting) return;
    this.isStarting = true;

    try {
      // Generate a stable client session key
      this.idempotencyKey = `sess_${bookId}_${Date.now()}`;
      const res = await statisticsApi.startSession(bookId, {
        idempotencyKey: this.idempotencyKey,
      });

      if (res?.session?.id) {
        this.activeSessionId = res.session.id;
        try {
          sessionStorage.setItem(`aks_session_${bookId}`, this.activeSessionId);
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[ReadingSessionManager] Could not start server session:', err);
    } finally {
      this.isStarting = false;
    }
  }

  async finish(bookId) {
    const targetBookId = bookId || this.activeBookId;
    let sessionId = this.activeSessionId;

    if (!sessionId && targetBookId) {
      try {
        sessionId = sessionStorage.getItem(`aks_session_${targetBookId}`);
      } catch (_) {}
    }

    if (!targetBookId || !sessionId || !isAuthenticated()) {
      this.activeBookId = null;
      this.activeSessionId = null;
      return null;
    }

    try {
      await statisticsApi.finishSession(targetBookId, sessionId);
      try {
        sessionStorage.removeItem(`aks_session_${targetBookId}`);
      } catch (_) {}
    } catch (err) {
      console.warn('[ReadingSessionManager] Could not finish server session:', err);
    } finally {
      this.activeBookId = null;
      this.activeSessionId = null;
    }
  }
}

export const readingSession = new ReadingSessionManager();

/**
 * Update a book's cover image thumbnail (either custom selected page or default page 1).
 * Supports both Authenticated (PostgreSQL + private storage) and Guest (IndexedDB) modes.
 */
export async function updateBookCover(bookId, coverBlob, pageNumber = 1, isCustom = true, placement = 'right') {
  if (isAuthenticated()) {
    const res = await booksApi.uploadBookCover(bookId, coverBlob, isCustom ? 'custom' : 'default', pageNumber, placement);
    const serverBook = res?.book;
    const coverUpdatedAt = serverBook?.colorScheme?.coverUpdatedAt || Date.now();
    const coverUrl = booksApi.getBookCoverUrl(bookId, coverUpdatedAt);
    const updated = {
      ...serverBook,
      isBackendBook: true,
      coverUrl,
      coverPlacement: serverBook?.colorScheme?.coverPlacement || placement || 'right',
      hasCustomCover: Boolean(serverBook?.colorScheme?.hasCustomCover),
      customCoverPage: serverBook?.colorScheme?.customCoverPage || null,
      defaultCoverPage: serverBook?.colorScheme?.defaultCoverPage || 1,
      coverTheme: {
        ...(serverBook?.colorScheme || {}),
        coverUrl,
        coverPlacement: serverBook?.colorScheme?.coverPlacement || placement || 'right',
      },
    };
    notifyDataChanged('books', { action: 'update', book: updated });
    return updated;
  }

  // Guest Mode: Update in IndexedDB
  const existing = await getLocalBook(bookId);
  if (!existing) throw new Error(`Book with id ${bookId} not found in guest storage.`);

  let coverDataUrl = null;
  if (coverBlob instanceof Blob) {
    coverDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(coverBlob);
    });
  } else if (typeof coverBlob === 'string') {
    coverDataUrl = coverBlob;
  }

  const updates = {
    coverImage: coverDataUrl,
    hasCustomCover: isCustom,
    coverPlacement: placement || existing.coverPlacement || 'right',
    customCoverImage: isCustom ? coverDataUrl : existing.customCoverImage,
    customCoverPage: isCustom ? pageNumber : existing.customCoverPage,
    defaultCoverImage: !isCustom ? coverDataUrl : (existing.defaultCoverImage || null),
    defaultCoverPage: !isCustom ? pageNumber : (existing.defaultCoverPage || 1),
    coverTheme: {
      ...(existing.coverTheme || {}),
      coverUrl: coverDataUrl,
      coverImage: coverDataUrl,
      hasCustomCover: isCustom,
      coverPlacement: placement || existing.coverPlacement || 'right',
      customCoverPage: isCustom ? pageNumber : existing.customCoverPage,
    },
    coverUpdatedAt: Date.now(),
  };

  const updated = await updateLocalBook(bookId, updates);
  notifyDataChanged('books', { action: 'update', book: updated });
  return updated;
}

/**
 * Update only a book's cover placement ('left' | 'right') without altering the cover image.
 * Works seamlessly in both Authenticated (PostgreSQL) and Guest (IndexedDB) modes.
 */
export async function updateBookCoverPlacement(bookId, placement = 'right') {
  const cleanPlacement = placement === 'left' ? 'left' : 'right';

  if (isAuthenticated()) {
    const res = await booksApi.updateCoverPlacement(bookId, cleanPlacement);
    const serverBook = res?.book;
    const coverUpdatedAt = serverBook?.colorScheme?.coverUpdatedAt || Date.now();
    const coverUrl = booksApi.getBookCoverUrl(bookId, coverUpdatedAt);
    const updated = {
      ...serverBook,
      isBackendBook: true,
      coverUrl,
      coverPlacement: cleanPlacement,
      hasCustomCover: Boolean(serverBook?.colorScheme?.hasCustomCover),
      customCoverPage: serverBook?.colorScheme?.customCoverPage || null,
      defaultCoverPage: serverBook?.colorScheme?.defaultCoverPage || 1,
      coverTheme: {
        ...(serverBook?.colorScheme || {}),
        coverUrl,
        coverPlacement: cleanPlacement,
      },
    };
    notifyDataChanged('books', { action: 'update', book: updated });
    return updated;
  }

  // Guest Mode: Update in IndexedDB
  const existing = await getLocalBook(bookId);
  if (!existing) throw new Error(`Book with id ${bookId} not found in guest storage.`);

  const updates = {
    coverPlacement: cleanPlacement,
    coverTheme: {
      ...(existing.coverTheme || {}),
      coverPlacement: cleanPlacement,
    },
    coverUpdatedAt: Date.now(),
  };

  const updated = await updateLocalBook(bookId, updates);
  notifyDataChanged('books', { action: 'update', book: updated });
  return updated;
}

/**
 * Reset a book's custom cover back to the automatically extracted default cover (page 1).
 * If defaultThumb is supplied, it ensures the first-page thumbnail is saved and restored.
 */
export async function resetBookCover(bookId, defaultThumb = null) {
  if (isAuthenticated()) {
    // 1. If a default thumbnail blob was provided, ensure it's saved as the default cover
    if (defaultThumb?.blob) {
      try {
        await booksApi.uploadBookCover(bookId, defaultThumb.blob, 'default', 1);
      } catch (err) {
        console.warn('[sanctuaryDataService] Could not upload default cover before reset:', err);
      }
    }

    const res = await booksApi.resetBookCover(bookId);
    const serverBook = res?.book;
    const coverUpdatedAt = serverBook?.colorScheme?.coverUpdatedAt || Date.now();
    const coverUrl = booksApi.getBookCoverUrl(bookId, coverUpdatedAt);
    const updated = {
      ...serverBook,
      isBackendBook: true,
      coverUrl,
      coverImage: defaultThumb?.dataUrl || null,
      customCoverImage: null,
      defaultCoverImage: defaultThumb?.dataUrl || null,
      coverPlacement: serverBook?.colorScheme?.coverPlacement || 'right',
      hasCustomCover: false,
      customCoverPage: null,
      defaultCoverPage: 1,
      coverTheme: {
        ...(serverBook?.colorScheme || {}),
        coverUrl,
        coverImage: defaultThumb?.dataUrl || null,
        coverPlacement: serverBook?.colorScheme?.coverPlacement || 'right',
        hasCustomCover: false,
        customCoverPage: null,
        defaultCoverPage: 1,
      },
    };
    notifyDataChanged('books', { action: 'update', book: updated });
    return updated;
  }

  // Guest Mode: Reset in IndexedDB
  const existing = await getLocalBook(bookId);
  if (!existing) throw new Error(`Book with id ${bookId} not found in guest storage.`);

  const defaultImg = defaultThumb?.dataUrl || existing.defaultCoverImage || null;
  const updates = {
    coverImage: defaultImg,
    defaultCoverImage: defaultImg,
    coverPlacement: existing.coverPlacement || 'right',
    hasCustomCover: false,
    customCoverImage: null,
    customCoverPage: null,
    defaultCoverPage: 1,
    coverTheme: {
      ...(existing.coverTheme || {}),
      coverUrl: defaultImg,
      coverImage: defaultImg,
      coverPlacement: existing.coverPlacement || 'right',
      hasCustomCover: false,
      customCoverPage: null,
      defaultCoverPage: 1,
    },
    coverUpdatedAt: Date.now(),
  };

  const updated = await updateLocalBook(bookId, updates);
  notifyDataChanged('books', { action: 'update', book: updated });
  return updated;
}
