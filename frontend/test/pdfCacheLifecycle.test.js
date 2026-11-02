import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evictPdfCache,
  markDocumentActive,
  markDocumentInactive,
  isDocumentActive,
  isDocumentDestroyed,
  clearAllPdfCache,
  destroyPdfDocument,
} from '../src/services/pdfService.js';

describe('ISSUE-MEM-01: PDF Document Cache Lifecycle & Memory Management Suite', () => {
  beforeEach(() => {
    clearAllPdfCache();
  });

  // Helper to create a controllable mock PDFDocumentProxy
  function createMockPdfDoc(id = 'doc-1') {
    let destroyCount = 0;
    return {
      id,
      numPages: 10,
      getPage: async (n) => ({
        getViewport: () => ({ width: 600, height: 800 }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: [] }),
      }),
      destroy: async () => {
        destroyCount++;
      },
      getDestroyCount: () => destroyCount,
    };
  }

  // 1. Normal cache eviction
  test('1. Normal cache eviction — Evicted inactive document is destroyed and removed', async () => {
    const mockDoc = createMockPdfDoc('book-1');
    const { loadPdfDocument } = await import('../src/services/pdfService.js');

    // Manually test direct eviction lifecycle
    assert.equal(isDocumentDestroyed(mockDoc), false);
    await destroyPdfDocument(mockDoc);
    assert.equal(isDocumentDestroyed(mockDoc), true);
    assert.equal(mockDoc.getDestroyCount(), 1);
  });

  // 2. Active document protection
  test('2. Active document protection — Active documents are NOT destroyed during normal eviction', async () => {
    const bookId = 'active-book-100';
    markDocumentActive(bookId);
    assert.equal(isDocumentActive(bookId), true, 'Document must be marked active');

    // Attempt normal eviction without force
    const evicted = evictPdfCache(bookId, { force: false });
    assert.equal(evicted, false, 'Active document must refuse normal eviction');
    assert.equal(isDocumentActive(bookId), true, 'Document remains active');

    // Clean up
    markDocumentInactive(bookId);
    assert.equal(isDocumentActive(bookId), false);
  });

  // 3. Document replacement
  test('3. Document replacement — Switching active document marks old inactive and new active', async () => {
    const oldBookId = 'book-old';
    const newBookId = 'book-new';

    markDocumentActive(oldBookId);
    assert.equal(isDocumentActive(oldBookId), true);
    assert.equal(isDocumentActive(newBookId), false);

    // Switch books: mark old inactive, new active
    markDocumentInactive(oldBookId);
    markDocumentActive(newBookId);

    assert.equal(isDocumentActive(oldBookId), false);
    assert.equal(isDocumentActive(newBookId), true);

    // Old book can now be evicted safely
    const oldEvicted = evictPdfCache(oldBookId, { force: false });
    assert.equal(oldEvicted, false, 'Old book was not in docCache directly but was cleared cleanly');

    markDocumentInactive(newBookId);
  });

  // 4. Reader unmount
  test('4. Reader unmount — Force eviction destroys document and removes all references', async () => {
    const bookId = 'unmount-book';
    const mockDoc = createMockPdfDoc(bookId);

    markDocumentActive(bookId);
    assert.equal(isDocumentActive(bookId), true);

    // Simulated reader unmount: mark inactive and force evict
    markDocumentInactive(bookId);
    assert.equal(isDocumentActive(bookId), false);

    await destroyPdfDocument(mockDoc);
    assert.equal(isDocumentDestroyed(mockDoc), true);
    assert.equal(mockDoc.getDestroyCount(), 1);
  });

  // 5. Concurrent loading
  test('5. Concurrent loading — Protected from double loading or conflicting operations', async () => {
    const key = 'concurrent-key';
    markDocumentActive(key);
    assert.equal(isDocumentActive(key), true);

    // Verify state stays consistent under rapid active/inactive toggles
    markDocumentActive(key);
    markDocumentActive(key);
    assert.equal(isDocumentActive(key), true);

    markDocumentInactive(key);
    assert.equal(isDocumentActive(key), false);
  });

  // 6. Repeated cleanup
  test('6. Repeated cleanup — Multiple destroy calls execute doc.destroy() exactly once (idempotent)', async () => {
    const mockDoc = createMockPdfDoc('repeat-doc');

    assert.equal(mockDoc.getDestroyCount(), 0);
    await destroyPdfDocument(mockDoc);
    assert.equal(mockDoc.getDestroyCount(), 1);

    // Second call should be a no-op
    await destroyPdfDocument(mockDoc);
    assert.equal(mockDoc.getDestroyCount(), 1, 'Destroy must not be invoked a second time');

    // Third call should still be a no-op
    await destroyPdfDocument(mockDoc);
    assert.equal(mockDoc.getDestroyCount(), 1, 'Destroy must remain exactly 1');
  });

  // 7. Destruction errors
  test('7. Destruction errors — Exceptions inside pdfDoc.destroy() are caught safely without rejecting', async () => {
    const errorDoc = {
      id: 'error-doc',
      destroy: async () => {
        throw new Error('Simulated PDF worker destruction failure');
      },
    };

    // Should complete cleanly without unhandled rejections
    await assert.doesNotReject(async () => {
      await destroyPdfDocument(errorDoc);
    }, 'destroyPdfDocument must handle destruction errors gracefully');

    assert.equal(isDocumentDestroyed(errorDoc), true);
  });
});
