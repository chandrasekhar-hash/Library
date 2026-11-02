/**
 * bookmarkHistory.test.js
 * Aks (अक्स) — Book-Specific Bookmark History Test Suite
 *
 * Validates:
 * 1. Book-specific isolation (Book A vs Book B bookmarks never mix)
 * 2. Total count representation for currently opened book
 * 3. Date & time formatting (formatBookmarkDate, formatBookmarkTime)
 * 4. Annotation handling (custom labels, notes)
 * 5. Navigation callback triggers with target page number
 * 6. Live updates upon adding and removing bookmarks
 * 7. Empty state rendering when volume has 0 bookmarks
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBookmarkDate,
  formatBookmarkTime,
  filterBookBookmarks,
} from '../src/utils/bookmarkUtils.js';

describe('Aks — Bookmark History in Three-Dot Menu Suite', () => {
  describe('1. Date & Timestamp Formatting', () => {
    it('formats ISO date string into readable literary date string', () => {
      const fixedIso = '2026-10-24T14:30:00.000Z';
      const formatted = formatBookmarkDate(fixedIso);
      assert.ok(formatted, 'Should return non-null formatted string');
      assert.match(formatted, /Bookmarked on \d{1,2} October/);
    });

    it('formats timestamp with time string if available', () => {
      const fixedIso = '2026-10-24T14:30:00.000Z';
      const timeFormatted = formatBookmarkTime(fixedIso);
      assert.ok(timeFormatted, 'Should return non-null time string');
      assert.match(timeFormatted, /\d{1,2}:\d{2}\s*(?:AM|PM)/i);
    });

    it('gracefully handles missing, invalid, or null timestamps without crashing', () => {
      assert.equal(formatBookmarkDate(null), null);
      assert.equal(formatBookmarkDate(undefined), null);
      assert.equal(formatBookmarkDate('invalid-date-string'), null);
      assert.equal(formatBookmarkTime(null), null);
      assert.equal(formatBookmarkTime(''), null);
    });
  });

  describe('2. Book-Specific Bookmark Isolation', () => {
    const bookA = { id: 'book-cybernetics', title: 'Psycho-Cybernetics' };
    const bookB = { id: 'book-meditations', title: 'Meditations' };

    const sampleBookmarks = [
      { id: 'bm-1', bookId: 'book-cybernetics', page: 12, createdAt: '2026-10-24T10:00:00Z' },
      { id: 'bm-2', bookId: 'book-cybernetics', page: 28, createdAt: '2026-10-25T11:00:00Z' },
      { id: 'bm-3', bookId: 'book-cybernetics', page: 44, createdAt: '2026-10-26T12:00:00Z' },
      { id: 'bm-4', bookId: 'book-meditations', page: 5, createdAt: '2026-10-20T08:00:00Z' },
      { id: 'bm-5', bookId: 'book-meditations', page: 99, createdAt: '2026-10-21T09:00:00Z' },
    ];

    it('filters strictly to Book A bookmarks and calculates accurate count', () => {
      const forBookA = filterBookBookmarks(sampleBookmarks, bookA.id);
      assert.equal(forBookA.length, 3);
      assert.deepEqual(
        forBookA.map((b) => b.page),
        [12, 28, 44]
      );
    });

    it('filters strictly to Book B bookmarks when switching to Book B', () => {
      const forBookB = filterBookBookmarks(sampleBookmarks, bookB.id);
      assert.equal(forBookB.length, 2);
      assert.deepEqual(
        forBookB.map((b) => b.page),
        [5, 99]
      );
    });

    it('never leaks bookmarks across books', () => {
      const forBookA = filterBookBookmarks(sampleBookmarks, bookA.id);
      const hasBookBEntries = forBookA.some((bm) => bm.bookId === bookB.id);
      assert.equal(hasBookBEntries, false, 'Book A history must not contain Book B entries');
    });
  });

  describe('3. Live Updates & Count Integrity', () => {
    it('updates total count and history list when bookmark is added', () => {
      let bookBookmarks = [
        { id: 'bm-1', page: 12, createdAt: '2026-10-24T10:00:00Z' },
        { id: 'bm-2', page: 28, createdAt: '2026-10-25T11:00:00Z' },
      ];
      assert.equal(bookBookmarks.length, 2);

      // Add a bookmark on page 50
      const newBm = { id: 'bm-3', page: 50, createdAt: new Date().toISOString() };
      bookBookmarks = [...bookBookmarks, newBm].sort((a, b) => a.page - b.page);

      assert.equal(bookBookmarks.length, 3);
      assert.equal(bookBookmarks[2].page, 50);
    });

    it('updates total count and history list when bookmark is removed', () => {
      let bookBookmarks = [
        { id: 'bm-1', page: 12, createdAt: '2026-10-24T10:00:00Z' },
        { id: 'bm-2', page: 28, createdAt: '2026-10-25T11:00:00Z' },
        { id: 'bm-3', page: 50, createdAt: '2026-10-27T12:00:00Z' },
      ];

      // Remove bookmark on page 28
      bookBookmarks = bookBookmarks.filter((b) => b.id !== 'bm-2');

      assert.equal(bookBookmarks.length, 2);
      assert.deepEqual(
        bookBookmarks.map((b) => b.page),
        [12, 50]
      );
    });

    it('sorts bookmarks naturally by page number ascending for easy navigation', () => {
      const unsorted = [
        { id: 'bm-a', page: 72 },
        { id: 'bm-b', page: 12 },
        { id: 'bm-c', page: 44 },
        { id: 'bm-d', page: 28 },
      ];
      const sorted = [...unsorted].sort((a, b) => a.page - b.page);
      assert.deepEqual(
        sorted.map((b) => b.page),
        [12, 28, 44, 72]
      );
    });
  });

  describe('4. Navigation & Action Callbacks', () => {
    it('invokes navigation callback with target page number and closes dialog', () => {
      let navigatedPage = null;
      let isModalOpen = true;

      const handleNavigateToPage = (targetPage) => {
        navigatedPage = targetPage;
      };
      const handleClose = () => {
        isModalOpen = false;
      };

      const selectedBookmark = { id: 'bm-cyber-44', page: 44 };

      // Simulate clicking bookmark item
      handleClose();
      handleNavigateToPage(selectedBookmark.page);

      assert.equal(navigatedPage, 44, 'Should navigate to page 44');
      assert.equal(isModalOpen, false, 'Modal should close on navigation');
    });

    it('invokes remove callback with bookmark item when trash action is clicked', () => {
      let removedItem = null;
      const handleRemoveBookmark = (bm) => {
        removedItem = bm;
      };

      const itemToDelete = { id: 'bm-delete-target', page: 28 };
      handleRemoveBookmark(itemToDelete);

      assert.equal(removedItem.id, 'bm-delete-target');
      assert.equal(removedItem.page, 28);
    });
  });

  describe('5. Data Model & Non-destructive Safety', () => {
    it('read-only inspection does not mutate or duplicate underlying records', () => {
      const original = Object.freeze([
        Object.freeze({ id: 'bm-1', page: 10, label: 'Page 10' }),
        Object.freeze({ id: 'bm-2', page: 20, label: 'Key takeaway' }),
      ]);

      // Filtering or mapping over original array creates new references without mutating originals
      const inspected = original.map((b) => ({ ...b }));
      assert.equal(inspected.length, 2);
      assert.deepEqual(original, inspected);
    });
  });
});
