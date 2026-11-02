import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpreadForIndex,
  getSpreadIndexForPage,
  getTotalSpreadsCount,
} from '../src/utils/bookDimensions.js';

test('Aks — Cover Page Placement (Left / Right) Suite', async (t) => {
  await t.test('1. Default Cover Placement Behavior', async (t2) => {
    await t2.test('Default placement for book with no preference is Right Page', () => {
      const spread = getSpreadForIndex(0, 10);
      assert.equal(spread.left, null, 'Left page of spread 0 should be null (inside cover endpaper)');
      assert.equal(spread.right, 1, 'Right page of spread 0 should be cover page 1');
      assert.equal(spread.mainPage, 1);
    });

    await t2.test('Explicit right placement produces identical standard layout', () => {
      const spread = getSpreadForIndex(0, 10, 'right');
      assert.equal(spread.left, null);
      assert.equal(spread.right, 1);
      assert.equal(spread.mainPage, 1);
    });
  });

  await t.test('2. Left Page Cover Placement Behavior', async (t2) => {
    await t2.test('Left placement places cover on left page and null on right page', () => {
      const spread = getSpreadForIndex(0, 10, 'left');
      assert.equal(spread.left, 1, 'Left page of spread 0 should display the cover page');
      assert.equal(spread.right, null, 'Right page of spread 0 should be null (inside cover endpaper)');
      assert.equal(spread.mainPage, 1);
    });

    await t2.test('Subsequent spreads (pages 2, 3...) remain correctly aligned', () => {
      const spread1 = getSpreadForIndex(1, 10, 'left');
      assert.equal(spread1.left, 2);
      assert.equal(spread1.right, 3);

      const spread2 = getSpreadForIndex(2, 10, 'left');
      assert.equal(spread2.left, 4);
      assert.equal(spread2.right, 5);
    });
  });

  await t.test('3. Custom Cover Page Interaction with Placement', async (t2) => {
    await t2.test('Custom cover page 5 placed on Left Page', () => {
      const spread = getSpreadForIndex(0, 10, 'left', 5);
      assert.equal(spread.left, 5, 'Left page of spread 0 displays custom cover page 5');
      assert.equal(spread.right, null, 'Right page of spread 0 displays inside cover endpaper');
      assert.equal(spread.mainPage, 5);
    });

    await t2.test('Custom cover page 5 placed on Right Page', () => {
      const spread = getSpreadForIndex(0, 10, 'right', 5);
      assert.equal(spread.left, null, 'Left page of spread 0 displays inside cover endpaper');
      assert.equal(spread.right, 5, 'Right page of spread 0 displays custom cover page 5');
      assert.equal(spread.mainPage, 5);
    });
  });

  await t.test('4. Per-Book Placement Persistence & Isolation', async (t2) => {
    await t2.test('Book A on Left and Book B on Right maintain isolated placements', () => {
      const bookA = {
        id: 'book-a-uuid',
        title: 'Book A',
        coverPlacement: 'left',
        totalPages: 20,
      };

      const bookB = {
        id: 'book-b-uuid',
        title: 'Book B',
        coverPlacement: 'right',
        totalPages: 15,
      };

      const spreadA = getSpreadForIndex(0, bookA.totalPages, bookA.coverPlacement);
      const spreadB = getSpreadForIndex(0, bookB.totalPages, bookB.coverPlacement);

      assert.equal(spreadA.left, 1, 'Book A cover is on Left page');
      assert.equal(spreadA.right, null, 'Book A right page is inside cover');

      assert.equal(spreadB.left, null, 'Book B left page is inside cover');
      assert.equal(spreadB.right, 1, 'Book B cover is on Right page');
    });

    await t2.test('Switching placement for a book dynamically updates opening spread', () => {
      let currentBook = {
        id: 'book-c-uuid',
        coverPlacement: 'right',
        totalPages: 12,
      };

      let initialSpread = getSpreadForIndex(0, currentBook.totalPages, currentBook.coverPlacement);
      assert.equal(initialSpread.left, null);
      assert.equal(initialSpread.right, 1);

      // User switches placement to Left Page
      currentBook = { ...currentBook, coverPlacement: 'left' };

      let updatedSpread = getSpreadForIndex(0, currentBook.totalPages, currentBook.coverPlacement);
      assert.equal(updatedSpread.left, 1);
      assert.equal(updatedSpread.right, null);

      // Reopening book restores saved Left Page placement
      const reopenedBook = JSON.parse(JSON.stringify(currentBook));
      const restoredSpread = getSpreadForIndex(0, reopenedBook.totalPages, reopenedBook.coverPlacement);
      assert.equal(restoredSpread.left, 1);
      assert.equal(restoredSpread.right, null);
    });
  });

  await t.test('5. Backward Compatibility & Edge Cases', async (t2) => {
    await t2.test('Legacy book with undefined/null placement safely defaults to Right Page', () => {
      const legacyBook = { id: 'legacy-book', totalPages: 8 };
      const placement = legacyBook.coverPlacement || legacyBook.colorScheme?.coverPlacement || 'right';
      const spread = getSpreadForIndex(0, legacyBook.totalPages, placement);

      assert.equal(placement, 'right');
      assert.equal(spread.left, null);
      assert.equal(spread.right, 1);
    });

    await t2.test('Single page book (totalPages = 1)', () => {
      const leftSpread = getSpreadForIndex(0, 1, 'left');
      assert.equal(leftSpread.left, 1);
      assert.equal(leftSpread.right, null);

      const rightSpread = getSpreadForIndex(0, 1, 'right');
      assert.equal(rightSpread.left, null);
      assert.equal(rightSpread.right, 1);
    });

    await t2.test('Empty book (totalPages = 0)', () => {
      const leftSpread = getSpreadForIndex(0, 0, 'left');
      assert.equal(leftSpread.left, null);
      assert.equal(leftSpread.right, null);

      const rightSpread = getSpreadForIndex(0, 0, 'right');
      assert.equal(rightSpread.left, null);
      assert.equal(rightSpread.right, null);
    });
  });
});
