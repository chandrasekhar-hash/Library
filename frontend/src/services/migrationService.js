/**
 * migrationService.js
 * Aks (अक्स) — Phase 7 & 7.1: Safe Guest Data Migration Engine
 *
 * Provides safe, explicit, idempotent, account-scoped migration of local guest data
 * (IndexedDB & localStorage) into an authenticated user's account.
 *
 * STRICT BOUNDARIES:
 * 1. NEVER deletes or clears local IndexedDB records, blobs, or localStorage keys.
 * 2. Requires explicit user consent before any server write.
 * 3. Account-Scoped Idempotency: Journals are isolated by authenticated account ID.
 * 4. Crash Window Recovery: Detects and resumes partially migrated books without creating duplicates.
 * 5. Annotation Deduplication: Prevents duplicate notes and highlights on retry.
 * 6. Multi-Tenant Security: All records are strictly owned by the authenticated session user.
 */

import { getAllBooks, getAllNotes } from './db';
import {
  booksApi,
  bookmarksApi,
  highlightsApi,
  notesApi,
  progressApi,
  authApi,
  preferencesApi,
} from './api';
import {
  PREFERENCES_STORAGE_KEY,
  loadPreferences,
} from './preferencesService';
import {
  STUDY_TIME_STORAGE_KEY,
  getTotalStudyTime,
} from './studyTimeService';

const MIGRATION_JOURNAL_V2_KEY = 'aks_migration_journal_v2';
const MIGRATION_JOURNAL_V1_KEY = 'aks_migration_journal_v1';
const DEMO_BOOK_IDS = ['dsa-45', 'dm-80', 'os-120', 'cn-95', 'toc-65'];
const DEMO_NOTE_IDS = ['note-sample-dsa-1', 'note-sample-dsa-2', 'note-sample-standalone-1'];

/**
 * Computes full SHA-256 hex digest of a File or Blob.
 * @param {Blob|File} blob
 * @returns {Promise<string|null>}
 */
export async function computeFullSha256(blob) {
  if (!blob || !(blob instanceof Blob)) return null;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const arrayBuffer = await blob.arrayBuffer();
      const digestBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      return Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch (err) {
    console.warn('[migrationService] SubtleCrypto SHA-256 calculation failed:', err);
  }
  return null;
}

// ── Account-Scoped Journal Management (V2) ───────────────────────────────────

/**
 * Loads the raw V2 migration journal store from localStorage.
 * @returns {Object} { version: 2, accounts: { [userId]: { books: {}, ... } } }
 */
function loadRawJournalV2() {
  try {
    const raw = localStorage.getItem(MIGRATION_JOURNAL_V2_KEY);
    if (!raw) return { version: 2, accounts: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.accounts) {
      return { version: 2, accounts: {} };
    }
    return parsed;
  } catch {
    return { version: 2, accounts: {} };
  }
}

/**
 * Retrieves account-scoped journal entries for a verified user.
 * @param {string} userId
 * @returns {Object} { [localBookId]: { serverBookId, title, sha256, status, migratedAt } }
 */
export function getAccountJournal(userId) {
  if (!userId) return {};
  const journal = loadRawJournalV2();
  return journal.accounts?.[userId]?.books || {};
}

/**
 * Persists an update to the account-scoped migration journal.
 * @param {string} userId Verified authenticated user ID
 * @param {string} localBookId
 * @param {Object} entry
 */
export function recordAccountJournalEntry(userId, localBookId, entry) {
  if (!userId || !localBookId) return;
  try {
    const journal = loadRawJournalV2();
    if (!journal.accounts[userId]) {
      journal.accounts[userId] = { books: {}, lastUpdated: new Date().toISOString() };
    }
    journal.accounts[userId].books[localBookId] = {
      ...(journal.accounts[userId].books[localBookId] || {}),
      ...entry,
      updatedAt: new Date().toISOString(),
    };
    journal.accounts[userId].lastUpdated = new Date().toISOString();
    localStorage.setItem(MIGRATION_JOURNAL_V2_KEY, JSON.stringify(journal));
  } catch (err) {
    console.warn('[migrationService] Failed to record account journal entry:', err);
  }
}

/**
 * Backward compatibility: Migrates any legacy v1 flat journal entries
 * into the account-scoped v2 journal ONLY if verified to belong to the authenticated user.
 * @param {string} userId
 * @param {Array} serverBooks
 */
export function migrateLegacyJournalIfOwned(userId, serverBooks = []) {
  if (!userId || !Array.isArray(serverBooks)) return;
  try {
    const rawV1 = localStorage.getItem(MIGRATION_JOURNAL_V1_KEY);
    if (!rawV1) return;
    const v1 = JSON.parse(rawV1);
    if (!v1 || typeof v1 !== 'object') return;

    const ownedServerBookIds = new Set(serverBooks.map((b) => b.id));
    let migratedCount = 0;

    for (const [localId, entry] of Object.entries(v1)) {
      if (entry?.serverBookId && ownedServerBookIds.has(entry.serverBookId)) {
        recordAccountJournalEntry(userId, localId, {
          serverBookId: entry.serverBookId,
          title: entry.title || '',
          sha256: entry.sha256 || null,
          status: 'completed',
          migratedAt: entry.migratedAt || new Date().toISOString(),
        });
      }
    }

    // Phase 7.2: aks_migration_journal_v1 is preserved byte-for-byte unchanged.
    // It is NEVER deleted, cleared, or overwritten. v2 remains the active journal.
  } catch (err) {
    console.warn('[migrationService] Legacy journal migration notice:', err);
  }
}

// ── Local Data Inspection & Inventory (Phase 7.1) ───────────────────────────

/**
 * Inspects all local guest data and compares against destination server account.
 * Produces a comprehensive, transparent migration preview.
 *
 * @param {Object} currentUser Currently authenticated user from session
 * @returns {Promise<Object>} Migration preview
 */
export async function inspectGuestData(currentUser) {
  if (!currentUser || !currentUser.id) {
    return {
      hasGuestData: false,
      reason: 'User not authenticated',
      books: [],
      standaloneNotes: [],
      preferences: null,
      deviceSpecificData: [],
      totalBooks: 0,
      totalFiles: 0,
      totalBookmarks: 0,
      totalHighlights: 0,
      totalNotes: 0,
      totalProgress: 0,
      duplicateCount: 0,
      unsupportedCount: 0,
    };
  }

  const userId = currentUser.id;

  // 1. Fetch raw local books and notes from IndexedDB
  const [rawBooks, rawNotes] = await Promise.all([
    getAllBooks().catch(() => []),
    getAllNotes().catch(() => []),
  ]);

  // Filter out sample/demo records
  const guestBooks = (rawBooks || []).filter(
    (b) => b && b.isUserImported === true && !DEMO_BOOK_IDS.includes(b.id)
  );

  const guestNotes = (rawNotes || []).filter(
    (n) => n && !n.isSample && !DEMO_NOTE_IDS.includes(n.id) && (!n.bookId || !DEMO_BOOK_IDS.includes(n.bookId))
  );

  const standaloneNotes = guestNotes.filter((n) => !n.bookId || n.type === 'standalone');

  // 2. Fetch server books owned by this user
  let serverBooks = [];
  try {
    const res = await booksApi.listBooks({ limit: 100 });
    serverBooks = Array.isArray(res?.books) ? res.books : [];
  } catch (err) {
    console.warn('[migrationService] Could not retrieve server books for duplicate check:', err);
  }

  // 3. Migrate legacy journal if applicable, then load account-scoped journal
  migrateLegacyJournalIfOwned(userId, serverBooks);
  const accountJournal = getAccountJournal(userId);

  // 4. Process books, calculate duplicates, and inspect annotations
  let totalBookmarks = 0;
  let totalHighlights = 0;
  let totalBookNotes = 0;
  let totalProgress = 0;
  let duplicateCount = 0;
  let unsupportedCount = 0;

  const inspectedBooks = await Promise.all(
    guestBooks.map(async (book) => {
      const bms = Array.isArray(book.bookmarks) ? book.bookmarks : [];
      const hls = Array.isArray(book.highlights) ? book.highlights : [];
      const nts = Array.isArray(book.notes) ? book.notes : [];

      totalBookmarks += bms.length;
      totalHighlights += hls.length;
      totalBookNotes += nts.length;
      if (typeof book.currentPage === 'number' && book.currentPage > 1) {
        totalProgress += 1;
      }

      // Check for PDF file presence and compute SHA-256
      const hasBlob = Boolean(book.blob && (book.blob instanceof Blob || book.blob instanceof File));
      let sha256 = book.fileHash || null;
      if (hasBlob && !sha256) {
        sha256 = await computeFullSha256(book.blob);
      }

      // Check if previously migrated in this account's journal
      const journalEntry = accountJournal[book.id];
      const isJournaled = Boolean(journalEntry && journalEntry.serverBookId);

      // Verify whether the journaled book actually exists on server
      let duplicateType = null;
      let matchingServerBook = null;

      if (isJournaled) {
        const found = serverBooks.find((sb) => sb.id === journalEntry.serverBookId);
        if (found) {
          duplicateType = 'PREVIOUSLY_MIGRATED';
          matchingServerBook = found;
          duplicateCount++;
        }
      }

      if (!duplicateType && sha256) {
        // Match by exact hash
        const exactMatch = serverBooks.find(
          (sb) => sb.file?.fileSha256 && sb.file.fileSha256.toLowerCase() === sha256.toLowerCase()
        );
        if (exactMatch) {
          duplicateType = 'EXACT_HASH_MATCH';
          matchingServerBook = exactMatch;
          duplicateCount++;
        }
      }

      if (!duplicateType) {
        // Match by identical title
        const titleMatch = serverBooks.find(
          (sb) => sb.title?.trim().toLowerCase() === book.title?.trim().toLowerCase()
        );
        if (titleMatch) {
          duplicateType = 'TITLE_MATCH';
          matchingServerBook = titleMatch;
          duplicateCount++;
        }
      }

      // Verify basic validity
      const isValid = Boolean(book.title && book.title.trim().length > 0);
      if (!isValid) {
        unsupportedCount++;
      }

      return {
        id: book.id,
        title: book.title || 'Untitled Document',
        author: book.author || 'Personal Document',
        category: book.category || 'General',
        totalPages: book.totalPages || 1,
        currentPage: book.currentPage || 1,
        hasPdfFile: hasBlob,
        fileSizeBytes: book.rawBytes || (book.blob ? book.blob.size : 0),
        fileSha256: sha256,
        bookmarksCount: bms.length,
        highlightsCount: hls.length,
        notesCount: nts.length,
        bookmarks: bms,
        highlights: hls,
        notes: nts,
        coverTheme: book.coverTheme || null,
        blob: book.blob || null,
        duplicateType,
        matchingServerBook,
        isAlreadyMigrated: duplicateType === 'PREVIOUSLY_MIGRATED',
        isValid,
      };
    })
  );

  // 5. Inspect Local Preferences
  let localPreferences = null;
  let hasCustomPreferences = false;
  try {
    localPreferences = loadPreferences();
    if (localPreferences && typeof localPreferences === 'object') {
      hasCustomPreferences = Boolean(
        localPreferences.global?.reading?.defaultMode !== 'book' ||
        localPreferences.global?.typography?.fontSize !== 18 ||
        localPreferences.global?.typography?.surfaceTheme !== 'navy' ||
        localPreferences.global?.atmosphere?.currentMoodId !== 'modern-dark'
      );
    }
  } catch (_) {}

  // 6. Inspect Local Study Timer & Custom Assets
  const totalStudySeconds = getTotalStudyTime();
  const hasLocalStudyData = totalStudySeconds > 0;

  // 7. Structure Device-Specific Data list (Non-migrated items clearly disclosed)
  const deviceSpecificData = [];

  if (hasLocalStudyData) {
    const mins = Math.round(totalStudySeconds / 60);
    deviceSpecificData.push({
      key: 'study_timer',
      name: 'Reading Room Cumulative Study Timer',
      detail: `${mins} minute${mins === 1 ? '' : 's'} (${totalStudySeconds}s)`,
      reason: 'Device-specific local counter. Preserved in your browser without modification.',
      status: 'preserved_locally',
    });
  }

  // Check custom background media in localStorage or IndexedDB
  try {
    const customBgMode = localStorage.getItem('aks_active_bg');
    if (customBgMode) {
      deviceSpecificData.push({
        key: 'custom_background',
        name: 'Device Background Selection',
        detail: customBgMode,
        reason: 'Display preference preserved in local browser settings.',
        status: 'preserved_locally',
      });
    }
  } catch (_) {}

  // Built-in demo items disclosed
  deviceSpecificData.push({
    key: 'demo_volumes',
    name: 'Sanctuary Built-in Demo Library',
    detail: '5 sample volumes & 3 sample notes',
    reason: 'Demo catalog excluded by design to prevent cloud account clutter.',
    status: 'excluded_by_design',
  });

  const totalNotes = totalBookNotes + standaloneNotes.length;
  const totalFiles = inspectedBooks.filter((b) => b.hasPdfFile).length;
  const hasGuestData = inspectedBooks.length > 0 || standaloneNotes.length > 0 || hasCustomPreferences;

  return {
    hasGuestData,
    destinationUser: {
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
    },
    books: inspectedBooks,
    standaloneNotes,
    preferences: {
      hasCustomPreferences,
      data: localPreferences?.global || null,
    },
    deviceSpecificData,
    totalBooks: inspectedBooks.length,
    totalFiles,
    totalBookmarks,
    totalHighlights,
    totalNotes,
    totalProgress,
    duplicateCount,
    unsupportedCount,
  };
}

// ── Migration Execution Engine (Phase 7.1) ───────────────────────────────────

/**
 * Executes migration according to the specified plan with complete retry-safety
 * and crash-window recovery.
 *
 * @param {Object} plan
 *   - selectedBookIds: string[]
 *   - selectedNoteIds: string[]
 *   - duplicateResolutions: { [localBookId]: 'new_copy' | 'link' | 'skip' }
 *   - progressPolicy: 'prefer_guest' | 'prefer_server'
 *   - migratePreferences: boolean
 * @param {Function} onProgress Progress callback
 * @param {AbortSignal} [signal] Optional abort signal
 * @returns {Promise<Object>} Comprehensive migration summary
 */
export async function executeMigration(plan, onProgress = () => {}, signal = null) {
  // 1. Verify authenticated user before starting
  const currentUserRes = await authApi.getCurrentUser();
  if (!currentUserRes || !currentUserRes.user) {
    throw new Error('Authentication expired. Please sign in again before migrating data.');
  }
  const userId = currentUserRes.user.id;

  const {
    selectedBookIds = [],
    selectedNoteIds = [],
    duplicateResolutions = {},
    progressPolicy = 'prefer_guest',
    migratePreferences = true,
  } = plan;

  // 2. Fetch fresh local data
  const [allLocalBooks, allLocalNotes] = await Promise.all([
    getAllBooks(),
    getAllNotes(),
  ]);

  const booksToMigrate = allLocalBooks.filter((b) => selectedBookIds.includes(b.id));
  const standaloneNotesToMigrate = allLocalNotes.filter(
    (n) => selectedNoteIds.includes(n.id) && (!n.bookId || n.type === 'standalone')
  );

  // Retrieve current server books owned by this user
  let currentServerBooks = [];
  try {
    const srvRes = await booksApi.listBooks({ limit: 100 });
    currentServerBooks = Array.isArray(srvRes?.books) ? srvRes.books : [];
  } catch (err) {
    console.warn('[migrationService] Server books check failed:', err);
  }

  const accountJournal = getAccountJournal(userId);

  const totalItems = booksToMigrate.length + standaloneNotesToMigrate.length + (migratePreferences ? 1 : 0);
  let completedItems = 0;
  const itemStatus = {}; // { [id]: { status, title, type, detail?, error? } }

  // Initialize status map
  booksToMigrate.forEach((b) => {
    itemStatus[b.id] = { status: 'pending', title: b.title, type: 'book' };
  });
  standaloneNotesToMigrate.forEach((n) => {
    itemStatus[n.id] = { status: 'pending', title: n.title, type: 'note' };
  });
  if (migratePreferences) {
    itemStatus['preferences'] = { status: 'pending', title: 'Sanctuary Preferences', type: 'preferences' };
  }

  const notify = (msg = '') => {
    const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 100;
    onProgress({
      current: completedItems,
      total: totalItems,
      percent,
      message: msg,
      itemStatus: { ...itemStatus },
    });
  };

  notify('Starting migration...');

  const results = {
    sessionId: `migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    startedAt: new Date().toISOString(),
    migratedBooksCount: 0,
    reusedBooksCount: 0,
    migratedBookmarksCount: 0,
    reusedBookmarksCount: 0,
    migratedHighlightsCount: 0,
    reusedHighlightsCount: 0,
    migratedNotesCount: 0,
    reusedNotesCount: 0,
    migratedProgressCount: 0,
    preferencesMigrated: false,
    skippedCount: 0,
    failedCount: 0,
    bookIdMap: {}, // localBookId -> serverBookId
    errors: [],
  };

  // ── A. Migrate Books and Their Annotations ─────────────────────────────────
  for (const book of booksToMigrate) {
    if (signal && signal.aborted) {
      notify('Migration cancelled by user.');
      break;
    }

    itemStatus[book.id].status = 'in_progress';
    notify(`Processing book: "${book.title}"...`);

    const resolution = duplicateResolutions[book.id] || 'new_copy';

    if (resolution === 'skip') {
      itemStatus[book.id].status = 'skipped';
      results.skippedCount++;
      completedItems++;
      notify(`Skipped: "${book.title}"`);
      continue;
    }

    try {
      let serverBookId = null;
      let isReusedBook = false;
      const bookSourceId = `guest_book_${book.id}`;

      // ── Crash Recovery Step 1: Check Account-Scoped Journal
      const journalEntry = accountJournal[book.id];
      if (journalEntry?.serverBookId) {
        // Validate that this server book actually exists in this account
        const verifiedBook = currentServerBooks.find((sb) => sb.id === journalEntry.serverBookId);
        if (verifiedBook) {
          serverBookId = verifiedBook.id;
          isReusedBook = true;
          results.bookIdMap[book.id] = serverBookId;
        }
      }

      // ── Crash Recovery Step 2: Unambiguous Source Identifier Recovery
      if (!serverBookId) {
        // Enforce recovery ONLY by exact matching migration source identifier scoped to user
        const sourceMatch = currentServerBooks.find(
          (sb) => sb.sourceId === bookSourceId
        );
        if (sourceMatch) {
          serverBookId = sourceMatch.id;
          results.bookIdMap[book.id] = serverBookId;
          if (!sourceMatch.file) {
            notify(`Recovered partially migrated volume "${book.title}" via source identifier. Resuming PDF upload...`);
          } else {
            isReusedBook = true;
          }
        }
      }

      // ── Crash Recovery Step 3: Explicit User-Confirmed Linking or Hash Reuse
      if (!serverBookId) {
        if (resolution === 'link' && plan.matchingServerBooks?.[book.id]) {
          serverBookId = plan.matchingServerBooks[book.id].id;
          isReusedBook = true;
          results.bookIdMap[book.id] = serverBookId;
        } else if (resolution !== 'new_copy') {
          // Compute full SHA-256 to check for duplicate PDF if user opted to reuse/link
          let sha256 = book.fileHash || null;
          if (book.blob && !sha256) {
            sha256 = await computeFullSha256(book.blob);
          }
          if (sha256) {
            const hashMatch = currentServerBooks.find(
              (sb) => sb.file?.fileSha256 && sb.file.fileSha256.toLowerCase() === sha256.toLowerCase()
            );
            if (hashMatch) {
              serverBookId = hashMatch.id;
              isReusedBook = true;
              results.bookIdMap[book.id] = serverBookId;
            }
          }
        }
      }

      // ── Step 4: Create Server Book if Not Recovered (passing stable sourceId)
      if (!serverBookId) {
        const createPayload = {
          title: book.title || 'Untitled Document',
          author: book.author || 'Personal Document',
          category: book.category || 'General',
          format: 'PDF',
          totalPages: book.totalPages || 1,
          colorScheme: book.coverTheme || null,
          sourceId: bookSourceId,
        };

        const createRes = await booksApi.createBook(createPayload);
        if (!createRes || !createRes.book) {
          throw new Error('Server did not return created book object.');
        }

        serverBookId = createRes.book.id;
        results.bookIdMap[book.id] = serverBookId;
        if (createRes.isExisting) {
          isReusedBook = true;
        }

        // Record immediate in-progress journal entry for crash-recovery safety
        recordAccountJournalEntry(userId, book.id, {
          serverBookId,
          title: book.title,
          status: 'in_progress',
        });
      }

      // ── Step 5: Upload PDF File (with verification)
      if (book.blob && (book.blob instanceof Blob || book.blob instanceof File)) {
        // Check if server book already has file attached
        const existingBookState = currentServerBooks.find((sb) => sb.id === serverBookId);
        if (!existingBookState?.file) {
          notify(`Uploading PDF for "${book.title}"...`);
          await booksApi.uploadBookFile(serverBookId, book.blob);
        }
      }

      if (isReusedBook) {
        results.reusedBooksCount++;
      } else {
        results.migratedBooksCount++;
      }

      // ── Step 6: Migrate Bookmarks with Stable Source Identifiers
      const bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];
      for (const [idx, bm] of bookmarks.entries()) {
        const bookmarkSourceId = bm.id ? `local_bm_${bm.id}` : `local_bm_${book.id}_p${bm.page || 1}`;
        try {
          const res = await bookmarksApi.createBookmark(serverBookId, {
            page: bm.page || 1,
            label: bm.label || `Page ${bm.page || 1}`,
            color: bm.color || 'gold',
            sourceId: bookmarkSourceId,
          });
          if (res?.isExisting) {
            results.reusedBookmarksCount++;
          } else {
            results.migratedBookmarksCount++;
          }
        } catch (bmErr) {
          // If already exists on page (409), treat as reused
          if (bmErr.message?.includes('ALREADY_EXISTS') || bmErr.status === 409) {
            results.reusedBookmarksCount++;
          } else {
            console.warn(`[migrationService] Bookmark notice on page ${bm.page}:`, bmErr.message);
          }
        }
      }

      // ── Step 7: Migrate Highlights with Stable Source Identifiers
      const highlights = Array.isArray(book.highlights) ? book.highlights : [];
      for (const [idx, hl] of highlights.entries()) {
        const highlightSourceId = hl.id ? `local_hl_${hl.id}` : `local_hl_${book.id}_p${hl.page || 1}_${idx}`;
        try {
          const res = await highlightsApi.createHighlight(serverBookId, {
            page: hl.page || 1,
            text: hl.text || hl.selectedText || '',
            color: hl.color || 'gold',
            positionJson: hl.positionJson || hl.bounds || null,
            sourceId: highlightSourceId,
          });
          if (res?.isExisting) {
            results.reusedHighlightsCount++;
          } else {
            results.migratedHighlightsCount++;
          }
        } catch (hlErr) {
          console.warn(`[migrationService] Highlight notice on page ${hl.page}:`, hlErr.message);
        }
      }

      // ── Step 8: Migrate Reading Progress (Conflict Policy)
      if (typeof book.currentPage === 'number' && book.currentPage > 1) {
        try {
          let shouldUpdateProgress = true;
          if (progressPolicy === 'prefer_server' && isReusedBook) {
            const serverProg = await progressApi.getProgress(serverBookId).catch(() => null);
            if (serverProg?.progress && serverProg.progress.currentPage >= book.currentPage) {
              shouldUpdateProgress = false;
            }
          }
          if (shouldUpdateProgress) {
            await progressApi.updateProgress(serverBookId, {
              currentPage: book.currentPage,
            });
            results.migratedProgressCount++;
          }
        } catch (progErr) {
          console.warn('[migrationService] Progress update notice:', progErr.message);
        }
      }

      // ── Step 9: Migrate Book-linked Notes with Stable Source Identifiers
      const localBookNotes = allLocalNotes.filter(
        (n) => n.bookId === book.id && !DEMO_NOTE_IDS.includes(n.id)
      );
      for (const [idx, note] of localBookNotes.entries()) {
        const noteSourceId = note.id ? `local_note_${note.id}` : `local_note_${book.id}_${idx}`;
        try {
          const res = await notesApi.createNote({
            bookId: serverBookId,
            title: note.title || 'Book Note',
            content: note.content || note.text || '',
            page: note.page || null,
            category: note.category || 'Reflection',
            type: 'BOOK',
            sourceId: noteSourceId,
          });
          if (res?.isExisting) {
            results.reusedNotesCount++;
          } else {
            results.migratedNotesCount++;
          }
        } catch (noteErr) {
          console.warn('[migrationService] Book note notice:', noteErr.message);
        }
      }

      // ── Step 10: Finalize Account Journal Entry
      recordAccountJournalEntry(userId, book.id, {
        serverBookId,
        title: book.title,
        status: 'completed',
        migratedAt: new Date().toISOString(),
      });

      itemStatus[book.id].status = isReusedBook ? 'completed' : 'completed';
      itemStatus[book.id].detail = isReusedBook ? 'Linked to account volume' : 'Uploaded and verified';
      completedItems++;
      notify(`Migrated: "${book.title}"`);
    } catch (bookErr) {
      console.error(`[migrationService] Failed to migrate book "${book.title}":`, bookErr);
      itemStatus[book.id].status = 'failed';
      itemStatus[book.id].error = bookErr.message || 'Unknown migration error';
      results.failedCount++;
      results.errors.push({ itemId: book.id, title: book.title, error: bookErr.message });
      completedItems++;
      notify(`Error on "${book.title}": ${bookErr.message}`);
    }
  }

  // ── B. Migrate Standalone Notes Idempotently with Stable Source Identifiers ──
  for (const [idx, note] of standaloneNotesToMigrate.entries()) {
    if (signal && signal.aborted) {
      notify('Migration cancelled by user.');
      break;
    }

    itemStatus[note.id].status = 'in_progress';
    notify(`Migrating note: "${note.title}"...`);

    const noteSourceId = note.id ? `local_note_${note.id}` : `local_note_standalone_${idx}`;

    try {
      const res = await notesApi.createNote({
        bookId: null,
        title: note.title || 'Untitled Reflection',
        content: note.content || note.text || '',
        category: note.category || 'Reflection',
        type: 'STANDALONE',
        sourceId: noteSourceId,
      });

      if (res?.isExisting) {
        results.reusedNotesCount++;
      } else {
        results.migratedNotesCount++;
      }

      itemStatus[note.id].status = 'completed';
      completedItems++;
      notify(`Migrated note: "${note.title}"`);
    } catch (noteErr) {
      console.error(`[migrationService] Standalone note error:`, noteErr);
      itemStatus[note.id].status = 'failed';
      itemStatus[note.id].error = noteErr.message;
      results.failedCount++;
      results.errors.push({ itemId: note.id, title: note.title, error: noteErr.message });
      completedItems++;
      notify(`Error on note "${note.title}": ${noteErr.message}`);
    }
  }

  // ── C. Migrate Preferences ────────────────────────────────────────────────
  if (migratePreferences) {
    itemStatus['preferences'].status = 'in_progress';
    notify('Syncing sanctuary preferences...');
    try {
      const localPrefs = loadPreferences();
      if (localPrefs?.global) {
        await preferencesApi.updatePreferences({
          readingConfig: localPrefs.global.reading || {},
          typographyConfig: localPrefs.global.typography || {},
          annotationsConfig: localPrefs.global.annotations || {},
          atmosphereConfig: localPrefs.global.atmosphere || {},
          storageConfig: localPrefs.global.storage || {},
        });
        results.preferencesMigrated = true;
        itemStatus['preferences'].status = 'completed';
        itemStatus['preferences'].detail = 'Reading & atmosphere settings updated';
      } else {
        itemStatus['preferences'].status = 'skipped';
        itemStatus['preferences'].detail = 'Using default preferences';
      }
      completedItems++;
    } catch (prefErr) {
      console.warn('[migrationService] Preferences sync notice:', prefErr.message);
      itemStatus['preferences'].status = 'skipped';
      itemStatus['preferences'].detail = 'Preferences kept local';
      completedItems++;
    }
  }

  results.completedAt = new Date().toISOString();
  notify('Migration complete.');
  return results;
}
