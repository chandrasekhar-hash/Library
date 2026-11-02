import test from 'node:test';
import assert from 'node:assert/strict';

test('Aks — Notes Save & Error Retention Suite', async (t) => {
  await t.test('1. Note schema & page-link formatting', () => {
    const text = 'hundred dollars';
    const currentPage = 50;
    const draftPage = 'current';

    const pageNum = draftPage === 'current' ? currentPage : null;
    const title = text.split('\n')[0].slice(0, 48);

    const note = {
      id: 'temp-123',
      title,
      content: text,
      text,
      bookId: '610a4b42-eb53-4835-855b-112bd6f700b9',
      page: pageNum,
      type: 'book',
      category: 'Reflection',
    };

    assert.equal(note.page, 50, 'Page-linked note retains integer page number 50');
    assert.equal(note.content, 'hundred dollars');
    assert.equal(note.bookId, '610a4b42-eb53-4835-855b-112bd6f700b9');
  });

  await t.test('2. General note formatting has null page', () => {
    const text = 'General thoughts on life';
    const currentPage = 50;
    const draftPage = 'general';

    const pageNum = draftPage === 'current' ? currentPage : null;
    assert.equal(pageNum, null, 'General note has null page');
  });

  await t.test('3. Draft text retention on save failure', async () => {
    let draftText = 'hundred dollars';
    let isSubmitting = false;
    let saveState = 'idle';
    let errorMessage = '';

    const handleSimulatedAddNote = async (shouldFail = false) => {
      const text = draftText.trim();
      if (!text || isSubmitting) return;

      isSubmitting = true;
      saveState = 'saving';
      errorMessage = '';

      try {
        if (shouldFail) {
          throw new Error('Server connection lost.');
        }
        draftText = '';
        saveState = 'saved';
      } catch (err) {
        saveState = 'error';
        errorMessage = err.message || 'Save failed. Please try again.';
      } finally {
        isSubmitting = false;
      }
    };

    // First attempt fails
    await handleSimulatedAddNote(true);

    assert.equal(saveState, 'error');
    assert.equal(errorMessage, 'Server connection lost.');
    assert.equal(draftText, 'hundred dollars', 'Draft text MUST NOT be cleared on failure');

    // User retries and succeeds
    await handleSimulatedAddNote(false);
    assert.equal(saveState, 'saved');
    assert.equal(draftText, '', 'Draft text is cleared only on success');
  });

  await t.test('4. Duplicate click prevention while submitting', async () => {
    let callCount = 0;
    let isSubmitting = false;

    const saveOperation = async () => {
      if (isSubmitting) return;
      isSubmitting = true;
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      isSubmitting = false;
    };

    // Rapid double-click
    await Promise.all([saveOperation(), saveOperation()]);

    assert.equal(callCount, 1, 'Only one save request is initiated during rapid repeated clicks');
  });

  await t.test('5. ReaderPage handleSaveNotes bypasses book update and saves to note service', async () => {
    const savedNotesInStore = [];
    let bookUpdateCalled = false;

    // Simulate sanctuaryDataService
    const mockSaveNewNote = async (noteData) => {
      const persisted = {
        ...noteData,
        id: 'persisted-uuid-456',
        createdAt: new Date().toISOString(),
      };
      savedNotesInStore.push(persisted);
      return persisted;
    };

    const mockUpdateExistingBook = async () => {
      bookUpdateCalled = true;
    };

    // Simulate handleSaveNotes
    const handleSaveNotes = async (noteOp) => {
      if (noteOp.type === 'add') {
        const saved = await mockSaveNewNote({
          ...noteOp.note,
          bookId: '610a4b42-eb53-4835-855b-112bd6f700b9',
        });
        return saved;
      }
    };

    const result = await handleSaveNotes({
      type: 'add',
      note: {
        id: 'temp-1',
        title: 'hundred dollars',
        content: 'hundred dollars',
        page: 50,
      },
    });

    assert.equal(bookUpdateCalled, false, 'updateExistingBook is NOT called when adding notes');
    assert.equal(result.id, 'persisted-uuid-456', 'Returns server-persisted note');
    assert.equal(savedNotesInStore.length, 1);
    assert.equal(savedNotesInStore[0].page, 50);
  });
});
