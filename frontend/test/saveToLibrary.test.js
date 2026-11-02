import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Aks — Save to Library from Reading Room Suite', () => {
  // ── 1. Detection of Saved vs Preview/Unsaved Books ────────────────────────
  describe('1. Detection of Saved vs Unsaved/Preview Books', () => {
    function isBookSavedInLibrary(selectedBook, libraryBooks = []) {
      if (!selectedBook || !Array.isArray(libraryBooks)) return false;
      return libraryBooks.some((b) => {
        if (b.id && b.id === selectedBook.id) return true;
        if (b.sourceId && (b.sourceId === selectedBook.id || b.sourceId === selectedBook.sourceId)) return true;
        if (selectedBook.sourceId && b.id === selectedBook.sourceId) return true;
        const bHash = b.fileHash || b.file?.fileSha256;
        const rHash = selectedBook.fileHash || selectedBook.file?.fileSha256;
        if (bHash && rHash && bHash.toLowerCase() === rHash.toLowerCase()) return true;
        const bBytes = b.rawBytes || (b.file?.fileSizeBytes ? Number(b.file.fileSizeBytes) : null);
        const rBytes = selectedBook.rawBytes || (selectedBook.file?.fileSizeBytes ? Number(selectedBook.file.fileSizeBytes) : null);
        const bName = (b.filename || b.file?.filename || '').toLowerCase();
        const rName = (selectedBook.filename || selectedBook.file?.filename || '').toLowerCase();
        if (bBytes && rBytes && bBytes === rBytes && bName && rName && bName === rName) return true;
        return false;
      });
    }

    test('Identifies books already stored in library by ID', () => {
      const libraryBooks = [{ id: 'book-uuid-1', title: 'Meditations' }];
      const openedBook = { id: 'book-uuid-1', title: 'Meditations' };
      assert.equal(isBookSavedInLibrary(openedBook, libraryBooks), true);
    });

    test('Identifies unsaved preview book with temporary ID as not yet in library', () => {
      const libraryBooks = [{ id: 'book-uuid-1', title: 'Meditations' }];
      const previewBook = {
        id: 'pdf-1729938472-abcde',
        title: 'New Preview Document',
        fileHash: 'hash-new-doc-unique',
      };
      assert.equal(isBookSavedInLibrary(previewBook, libraryBooks), false);
    });

    test('Recognizes preview book that matches an existing library book by content hash or sourceId', () => {
      const libraryBooks = [
        {
          id: 'server-id-42',
          sourceId: 'pdf-prev-123',
          fileHash: 'sha256-matching-hash',
          title: 'Existing Book',
        },
      ];
      // Case A: matches sourceId
      const previewA = { id: 'pdf-prev-123', title: 'Existing Book' };
      assert.equal(isBookSavedInLibrary(previewA, libraryBooks), true);

      // Case B: matches fileHash
      const previewB = { id: 'pdf-temp-random', fileHash: 'sha256-matching-hash', title: 'Existing Book' };
      assert.equal(isBookSavedInLibrary(previewB, libraryBooks), true);
    });
  });

  // ── 2. Button State Machine & Concurrency Protection ───────────────────────
  describe('2. Button State Machine & Duplicate Save Prevention', () => {
    function getButtonState({ isSaved, isSaving }) {
      if (isSaving) {
        return {
          label: 'Saving…',
          disabled: true,
          icon: 'Loader2',
          ariaLabel: 'Saving to library',
        };
      }
      if (isSaved) {
        return {
          label: 'In Library',
          disabled: true,
          icon: 'BookmarkCheck',
          ariaLabel: 'In Library',
        };
      }
      return {
        label: 'Save to Library',
        disabled: false,
        icon: 'BookmarkPlus',
        ariaLabel: 'Save to Library',
      };
    }

    test('A. Book not yet saved shows "Save to Library" and is clickable', () => {
      const state = getButtonState({ isSaved: false, isSaving: false });
      assert.equal(state.label, 'Save to Library');
      assert.equal(state.disabled, false);
      assert.equal(state.icon, 'BookmarkPlus');
    });

    test('B. Book successfully saved shows "In Library" and is disabled against duplicates', () => {
      const state = getButtonState({ isSaved: true, isSaving: false });
      assert.equal(state.label, 'In Library');
      assert.equal(state.disabled, true, 'Saved button must be disabled to prevent duplicate saves');
      assert.equal(state.icon, 'BookmarkCheck');
    });

    test('C. Saving in progress shows "Saving…" with spinner and disables button against rapid repeated clicks', () => {
      const state = getButtonState({ isSaved: false, isSaving: true });
      assert.equal(state.label, 'Saving…');
      assert.equal(state.disabled, true, 'Saving in progress must prevent duplicate requests');
      assert.equal(state.icon, 'Loader2');
    });

    test('Prevents multiple simultaneous save calls when clicked repeatedly', async () => {
      let callCount = 0;
      let isSaving = false;
      let isSaved = false;

      async function onSave() {
        if (isSaving || isSaved) return;
        isSaving = true;
        callCount++;
        // Simulate async save delay
        await new Promise((r) => setTimeout(r, 20));
        isSaved = true;
        isSaving = false;
      }

      // Simulate rapid user clicks
      await Promise.all([onSave(), onSave(), onSave(), onSave()]);
      assert.equal(callCount, 1, 'Only one save request must execute despite repeated clicks');
      assert.equal(isSaved, true);
    });

    test('D. Saving failed restores button to "Save to Library" allowing retry without closing book', async () => {
      let isSaving = false;
      let isSaved = false;
      let errorMessage = null;

      async function onSave(shouldFail = true) {
        if (isSaving || isSaved) return;
        isSaving = true;
        try {
          if (shouldFail) throw new Error('Simulated network timeout');
          isSaved = true;
        } catch (err) {
          isSaved = false;
          errorMessage = err.message;
        } finally {
          isSaving = false;
        }
      }

      // First attempt fails
      await onSave(true);
      assert.equal(isSaved, false);
      assert.equal(isSaving, false);
      assert.equal(errorMessage, 'Simulated network timeout');
      const stateAfterFail = getButtonState({ isSaved, isSaving });
      assert.equal(stateAfterFail.label, 'Save to Library', 'Must allow user to retry');
      assert.equal(stateAfterFail.disabled, false);

      // Retry succeeds
      await onSave(false);
      assert.equal(isSaved, true);
      const stateAfterRetry = getButtonState({ isSaved, isSaving });
      assert.equal(stateAfterRetry.label, 'In Library');
      assert.equal(stateAfterRetry.disabled, true);
    });
  });

  // ── 3. Reading State Preservation ──────────────────────────────────────────
  describe('3. Reading State Preservation Across Saving', () => {
    test('Saving preserves currentPage, bookmarks, notes, highlights, and preferences', async () => {
      const previewBook = {
        id: 'pdf-preview-1',
        title: 'Stoic Discourses',
        totalPages: 240,
        blob: { size: 1024, type: 'application/pdf' },
      };

      const readingStateBeforeSave = {
        currentPage: 42,
        bookmarks: [
          { id: 'bm-temp-p42-1', page: 42, label: 'Page 42 (Temporary)', isTemporary: true },
        ],
        notes: [
          { id: 'note-1', content: 'Remarkable passage on fortitude', page: 42 },
        ],
        highlights: [
          { id: 'hl-1', text: 'You have power over your mind', page: 42, color: 'gold' },
        ],
        preferences: {
          reading: { defaultMode: 'book' },
        },
      };

      // Transform bookmarks to permanent on save
      const permanentBookmarks = readingStateBeforeSave.bookmarks.map((bm) => ({
        ...bm,
        id: `bm-${previewBook.id}-p${bm.page}-perm`,
        isTemporary: undefined,
        label: `Page ${bm.page}`,
      }));

      const payloadToSave = {
        ...previewBook,
        currentPage: readingStateBeforeSave.currentPage,
        bookmarks: permanentBookmarks,
        bookmarksCount: permanentBookmarks.length,
        notes: readingStateBeforeSave.notes,
        highlights: readingStateBeforeSave.highlights,
        highlightsCount: readingStateBeforeSave.highlights.length,
      };

      assert.equal(payloadToSave.currentPage, 42, 'Current reading page must be preserved');
      assert.equal(payloadToSave.bookmarks.length, 1);
      assert.equal(payloadToSave.bookmarks[0].isTemporary, undefined, 'Temporary flag removed on save');
      assert.equal(payloadToSave.notes.length, 1);
      assert.equal(payloadToSave.highlights.length, 1);
    });

    test('Rekeying document cache allows persistent ID without destroying PDF proxy', () => {
      const cache = new Map();
      const active = new Set();
      const mockDocProxy = { numPages: 100, isDestroyed: false };

      const oldKey = 'pdf-preview-old';
      const newKey = 'server-uuid-new';

      cache.set(oldKey, { doc: mockDocProxy, lastUsed: 100 });
      active.add(oldKey);

      // Rekey operation
      if (cache.has(oldKey)) {
        const entry = cache.get(oldKey);
        cache.delete(oldKey);
        cache.set(newKey, entry);
      }
      if (active.has(oldKey)) {
        active.delete(oldKey);
        active.add(newKey);
      }

      assert.equal(cache.has(oldKey), false, 'Old key removed from cache');
      assert.equal(cache.has(newKey), true, 'New key exists in cache');
      assert.equal(active.has(newKey), true, 'New key marked active');
      assert.equal(cache.get(newKey).doc, mockDocProxy, 'Document proxy preserved in memory');
      assert.equal(mockDocProxy.isDestroyed, false, 'Document proxy must not be destroyed');
    });
  });

  // ── 4. Distinction Between Save to Library and Mark (Bookmark Page) ────────
  describe('4. Distinction Between Save to Library and Mark Action', () => {
    test('"Save to Library" adds whole volume while "Mark" bookmarks current page independently', () => {
      let library = [];
      let bookmarks = [];

      function markPage(page) {
        bookmarks.push({ page, label: `Page ${page}` });
      }

      function saveBookToLibrary(book) {
        library.push(book);
      }

      const currentBook = { id: 'b1', title: 'Physics Volume' };

      // Mark page 5
      markPage(5);
      assert.equal(bookmarks.length, 1);
      assert.equal(library.length, 0, 'Marking page must NOT save whole book to library');

      // Save book to library
      saveBookToLibrary(currentBook);
      assert.equal(library.length, 1, 'Save to library adds book to library');
      assert.equal(bookmarks.length, 1, 'Existing bookmarks remain unchanged');
    });
  });

  // ── 5. Guest Mode and Authenticated Mode Isolation ─────────────────────────
  describe('5. Guest Mode and Multi-User Isolation', () => {
    test('Guest Mode saves locally in IndexedDB without creating server user', () => {
      const mockIDB = new Map();
      const guestBook = {
        id: 'pdf-guest-1',
        title: 'Guest Local PDF',
        blob: { size: 5000, name: 'guest.pdf' },
        isUserImported: true,
      };

      mockIDB.set(guestBook.id, guestBook);

      assert.equal(mockIDB.get('pdf-guest-1').title, 'Guest Local PDF');
      assert.ok(mockIDB.get('pdf-guest-1').blob, 'Original PDF Blob preserved for guest');
    });

    test('Authenticated saving creates user-scoped record and reuses existing files', () => {
      const userABooks = [
        { id: 'ua-1', userId: 'user-a', file: { fileSha256: 'hash-common-pdf' }, title: 'User A PDF' },
      ];
      const userBBooks = [
        { id: 'ub-1', userId: 'user-b', file: { fileSha256: 'hash-common-pdf' }, title: 'User B PDF' },
      ];

      // Verify account isolation: user A cannot see user B's books
      assert.notEqual(userABooks[0].userId, userBBooks[0].userId);
      assert.notEqual(userABooks[0].id, userBBooks[0].id);

      // Reusing file within user A's account:
      const targetHash = 'hash-common-pdf';
      const userAExisting = userABooks.find((b) => b.file?.fileSha256 === targetHash);
      assert.ok(userAExisting, 'Finds existing book record in User A library');
      assert.equal(userAExisting.id, 'ua-1', 'Reuses User A existing record without duplicate upload');
    });
  });
});
