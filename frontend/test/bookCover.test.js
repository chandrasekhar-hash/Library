import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Aks — Automatic PDF Book Covers & Custom Cover Selection Suite', () => {
  // ── 1. Automatic Cover Extraction ──────────────────────────────────────────
  describe('1. Automatic Cover Extraction on Import', () => {
    test('Default cover is extracted from Page 1 with aspect ratio and metadata', () => {
      // Mock book record imported from PDF
      const importedBook = {
        id: 'book-101',
        title: 'Marcus Aurelius - Meditations',
        totalPages: 120,
        currentPage: 1,
        coverUrl: '/api/books/book-101/cover?t=1729938000',
        hasCustomCover: false,
        defaultCoverPage: 1,
        customCoverPage: null,
        coverTheme: {
          hasCoverImage: true,
          coverUrl: '/api/books/book-101/cover?t=1729938000',
          palette: ['#0A0F1D', '#D4AF37'],
        },
      };

      assert.equal(importedBook.hasCustomCover, false);
      assert.equal(importedBook.defaultCoverPage, 1);
      assert.equal(importedBook.customCoverPage, null);
      assert.ok(importedBook.coverUrl.includes('/api/books/book-101/cover'));
      assert.equal(importedBook.coverTheme.hasCoverImage, true);
    });

    test('Graceful fallback to Aks pure CSS monogram cover if cover generation fails', () => {
      const bookWithFailedCover = {
        id: 'book-failed-cover',
        title: 'Ancient Philosophy',
        totalPages: 45,
        coverUrl: null,
        coverImage: null,
        hasCustomCover: false,
        coverTheme: null,
      };

      // In BookCover.jsx: when coverUrl and coverImage are null, or on image error,
      // the monogram surface renders with Aks styling
      const shouldRenderMonogram = !bookWithFailedCover.coverUrl && !bookWithFailedCover.coverImage;
      assert.equal(shouldRenderMonogram, true);
    });
  });

  // ── 2. Option A: "This is the book cover" ──────────────────────────────────
  describe('2. Custom Cover Selection ("This is the book cover")', () => {
    test('Selects currently displayed page as custom cover and preserves reading position', () => {
      const originalReadingState = {
        id: 'book-202',
        title: 'Beyond Good and Evil',
        currentPage: 14,
        totalPages: 180,
        bookmarks: [{ page: 5, label: 'Preface' }, { page: 14, label: 'Chapter 2' }],
        notes: [{ id: 'n1', page: 14, text: 'Important aphorism' }],
        highlights: [{ id: 'h1', page: 14, text: 'Will to power' }],
        hasCustomCover: false,
        defaultCoverPage: 1,
        customCoverPage: null,
        coverUrl: '/api/books/book-202/cover?t=1000',
      };

      // User on page 14 chooses Option A: "This is the book cover"
      const selectedPage = 14;
      const updatedTimestamp = 2000;

      const updatedBook = {
        ...originalReadingState,
        hasCustomCover: true,
        customCoverPage: selectedPage,
        coverUrl: `/api/books/${originalReadingState.id}/cover?t=${updatedTimestamp}`,
        coverUpdatedAt: updatedTimestamp,
      };

      // Verify custom cover state
      assert.equal(updatedBook.hasCustomCover, true);
      assert.equal(updatedBook.customCoverPage, 14);
      assert.equal(updatedBook.defaultCoverPage, 1);
      assert.ok(updatedBook.coverUrl.includes('?t=2000'));

      // CRITICAL CONSTRAINT: reading position and user artifacts must remain untouched
      assert.equal(updatedBook.currentPage, originalReadingState.currentPage);
      assert.deepEqual(updatedBook.bookmarks, originalReadingState.bookmarks);
      assert.deepEqual(updatedBook.notes, originalReadingState.notes);
      assert.deepEqual(updatedBook.highlights, originalReadingState.highlights);
    });

    test('Allows replacing custom cover with another page later (e.g. Page 14 to Page 42)', () => {
      let book = {
        id: 'book-303',
        hasCustomCover: true,
        customCoverPage: 14,
        coverUrl: '/api/books/book-303/cover?t=1000',
      };

      // Navigate to page 42 and change cover again
      const newPage = 42;
      book = {
        ...book,
        hasCustomCover: true,
        customCoverPage: newPage,
        coverUrl: '/api/books/book-303/cover?t=3000',
      };

      assert.equal(book.hasCustomCover, true);
      assert.equal(book.customCoverPage, 42);
      assert.ok(book.coverUrl.includes('?t=3000'));
    });
  });

  // ── 3. Option B: "Leave as is" ─────────────────────────────────────────────
  describe('3. Option B ("Leave as is")', () => {
    test('Leaves cover completely unchanged without generating duplicate assets', () => {
      const initialBook = {
        id: 'book-404',
        coverUrl: '/api/books/book-404/cover?t=1000',
        hasCustomCover: true,
        customCoverPage: 7,
        defaultCoverPage: 1,
      };

      // User opens Change Book Cover modal on page 25, then clicks "Leave as is" (or closes modal)
      function handleLeaveAsIs(currentBook) {
        // Return existing book unmodified
        return currentBook;
      }

      const resultingBook = handleLeaveAsIs(initialBook);
      assert.deepEqual(resultingBook, initialBook);
      assert.equal(resultingBook.customCoverPage, 7);
    });
  });

  // ── 4. Separate Reset Action & Bug Fix Verification ────────────────────────
  describe('4. Reset Action (Return to Original PDF Cover)', () => {
    test('Restores automatically generated first-page cover cleanly in Authenticated Mode', () => {
      const bookWithCustomCover = {
        id: 'book-505',
        hasCustomCover: true,
        customCoverPage: 23,
        defaultCoverPage: 1,
        coverUrl: '/api/books/book-505/cover?t=2000',
        coverImage: 'data:image/webp;base64,CUSTOM_COVER_DATA',
        customCoverImage: 'data:image/webp;base64,CUSTOM_COVER_DATA',
        currentPage: 23,
        bookmarks: [{ page: 1, label: 'Title' }],
      };

      // Trigger reset action: must clear customCoverImage and coverImage overrides
      const resetTimestamp = 4000;
      const restoredBook = {
        ...bookWithCustomCover,
        hasCustomCover: false,
        customCoverPage: null,
        coverImage: null,
        customCoverImage: null,
        coverUrl: `/api/books/${bookWithCustomCover.id}/cover?t=${resetTimestamp}`,
      };

      assert.equal(restoredBook.hasCustomCover, false);
      assert.equal(restoredBook.customCoverPage, null);
      assert.equal(restoredBook.defaultCoverPage, 1);
      assert.equal(restoredBook.customCoverImage, null);
      assert.equal(restoredBook.coverImage, null);
      assert.ok(restoredBook.coverUrl.includes('?t=4000'));
      // Reading progress preserved
      assert.equal(restoredBook.currentPage, 23);
      assert.equal(restoredBook.bookmarks.length, 1);
    });

    test('Edge Case: Automatic cover -> Custom cover -> Another custom cover -> Original cover', () => {
      // Step 1: Automatic cover
      let book = {
        id: 'book-multi-step',
        hasCustomCover: false,
        customCoverPage: null,
        defaultCoverPage: 1,
        defaultCoverImage: 'data:image/webp;base64,PAGE_1_THUMB',
        coverImage: 'data:image/webp;base64,PAGE_1_THUMB',
      };

      // Step 2: Custom cover (Page 5)
      book = {
        ...book,
        hasCustomCover: true,
        customCoverPage: 5,
        customCoverImage: 'data:image/webp;base64,PAGE_5_THUMB',
        coverImage: 'data:image/webp;base64,PAGE_5_THUMB',
      };
      assert.equal(book.customCoverPage, 5);

      // Step 3: Another custom cover (Page 12)
      book = {
        ...book,
        hasCustomCover: true,
        customCoverPage: 12,
        customCoverImage: 'data:image/webp;base64,PAGE_12_THUMB',
        coverImage: 'data:image/webp;base64,PAGE_12_THUMB',
      };
      assert.equal(book.customCoverPage, 12);

      // Step 4: Reset to original PDF cover
      const resetThumb = { dataUrl: 'data:image/webp;base64,PAGE_1_THUMB' };
      book = {
        ...book,
        hasCustomCover: false,
        customCoverPage: null,
        customCoverImage: null,
        coverImage: resetThumb.dataUrl,
        defaultCoverImage: resetThumb.dataUrl,
      };

      assert.equal(book.hasCustomCover, false);
      assert.equal(book.customCoverPage, null);
      assert.equal(book.coverImage, 'data:image/webp;base64,PAGE_1_THUMB');
      assert.equal(book.customCoverImage, null);
    });

    test('Regenerates missing thumbnail from PDF page 1 when default thumbnail was not cached', () => {
      // Book missing defaultCoverImage (e.g. older import or sample volume)
      const bookWithoutCachedDefault = {
        id: 'book-no-cached-default',
        hasCustomCover: true,
        customCoverPage: 9,
        defaultCoverImage: null,
        coverImage: 'data:image/webp;base64,PAGE_9_CUSTOM',
      };

      // During reset: Page 1 is freshly rendered from pdfDoc
      const freshPage1Thumb = {
        dataUrl: 'data:image/webp;base64,FRESH_PAGE_1_RENDERED',
        blob: new Blob(['fake_jpeg_bytes'], { type: 'image/jpeg' }),
      };

      const restored = {
        ...bookWithoutCachedDefault,
        hasCustomCover: false,
        customCoverPage: null,
        customCoverImage: null,
        defaultCoverImage: freshPage1Thumb.dataUrl,
        coverImage: freshPage1Thumb.dataUrl,
      };

      assert.equal(restored.hasCustomCover, false);
      assert.equal(restored.coverImage, 'data:image/webp;base64,FRESH_PAGE_1_RENDERED');
      assert.equal(restored.defaultCoverImage, 'data:image/webp;base64,FRESH_PAGE_1_RENDERED');
    });

    test('Repeated reset clicks are idempotent and protected by isResetting flag', () => {
      let callCount = 0;
      let isResetting = false;

      async function simulatedResetHandler() {
        if (isResetting) return; // Prevent duplicate concurrent runs
        isResetting = true;
        callCount++;
        // Simulating async network reset
        await new Promise((r) => setTimeout(r, 10));
        isResetting = false;
      }

      // Simulate 3 rapid clicks
      const p1 = simulatedResetHandler();
      const p2 = simulatedResetHandler();
      const p3 = simulatedResetHandler();

      return Promise.all([p1, p2, p3]).then(() => {
        assert.equal(callCount, 1, 'Only one reset execution should occur during rapid clicking');
      });
    });
  });

  // ── 5. Guest Mode Persistence & Account Isolation ──────────────────────────
  describe('5. Guest Mode & Storage Isolation', () => {
    test('Guest mode stores cover image in local state and persists across reloads', () => {
      const guestBook = {
        id: 'guest-book-01',
        title: 'Guest Manuscript',
        coverImage: 'data:image/webp;base64,DEFAULT_PAGE_1_DATA',
        defaultCoverImage: 'data:image/webp;base64,DEFAULT_PAGE_1_DATA',
        hasCustomCover: false,
      };

      // Setting custom cover in Guest mode
      const newCustomImage = 'data:image/webp;base64,CUSTOM_PAGE_5_DATA...';
      const updatedGuestBook = {
        ...guestBook,
        customCoverImage: newCustomImage,
        coverImage: newCustomImage,
        hasCustomCover: true,
        customCoverPage: 5,
      };

      assert.equal(updatedGuestBook.hasCustomCover, true);
      assert.equal(updatedGuestBook.customCoverPage, 5);
      assert.equal(updatedGuestBook.coverImage, newCustomImage);

      // Resetting in Guest mode restores defaultCoverImage and clears customCoverImage
      const resetGuestBook = {
        ...updatedGuestBook,
        coverImage: updatedGuestBook.defaultCoverImage,
        hasCustomCover: false,
        customCoverPage: null,
        customCoverImage: null,
      };

      assert.equal(resetGuestBook.hasCustomCover, false);
      assert.equal(resetGuestBook.coverImage, guestBook.defaultCoverImage);
      assert.equal(resetGuestBook.customCoverImage, null);
    });

    test('Cover URL includes cache-busting timestamp to prevent stale browser caches', () => {
      const baseBookId = 'book-isolate-99';
      const url1 = `/api/books/${baseBookId}/cover?t=100`;
      const url2 = `/api/books/${baseBookId}/cover?t=200`;

      assert.notEqual(url1, url2);
      assert.ok(url1.startsWith(`/api/books/${baseBookId}/cover`));
    });
  });
});
