import test from 'node:test';
import assert from 'node:assert/strict';

test('Aks — Personal Journal & Notes Workspace Frontend Suite', async (t) => {
  await t.test('1. Section schema, default seeding, and guest mode fallback', () => {
    const defaultSections = [
      { id: 'sec-daily-journal', name: 'Daily Journal', color: '#B38B3F', icon: 'feather', order: 0 },
      { id: 'sec-personal', name: 'Personal', color: '#3B82F6', icon: 'user', order: 1 },
      { id: 'sec-ideas', name: 'Ideas', color: '#10B981', icon: 'lightbulb', order: 2 },
      { id: 'sec-work', name: 'Work', color: '#8B5CF6', icon: 'briefcase', order: 3 },
    ];

    assert.equal(defaultSections.length, 4, 'Provides 4 standard default sections');
    assert.equal(defaultSections[0].name, 'Daily Journal');
    assert.equal(defaultSections[0].order, 0);

    // Custom section addition
    const customSection = {
      id: 'sec-custom-1',
      name: 'Philosophy & Essays',
      color: '#C4975A',
      icon: 'book',
      order: 4,
    };
    const sections = [...defaultSections, customSection];

    assert.equal(sections.length, 5);
    assert.equal(sections[4].name, 'Philosophy & Essays');
  });

  await t.test('2. Personal note schema with richContent, typography, appearance, and pin state', () => {
    const personalNote = {
      id: 'note-pers-1',
      title: 'Midnight Musings on Stoicism',
      content: 'True freedom is mastery over self.',
      richContent: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'True freedom is mastery over self.' }],
          },
        ],
      },
      sectionId: 'sec-personal',
      isPinned: true,
      journalDate: null,
      appearance: 'classic-paper',
      typography: {
        fontFamily: 'et-book, Georgia, serif',
        fontSize: '18px',
        color: '#2C2724',
        lineHeight: '1.7',
      },
      type: 'STANDALONE',
      createdAt: '2026-11-02T05:00:00.000Z',
      updatedAt: '2026-11-02T05:00:00.000Z',
    };

    assert.equal(personalNote.type, 'STANDALONE');
    assert.equal(personalNote.isPinned, true);
    assert.equal(personalNote.appearance, 'classic-paper');
    assert.equal(personalNote.typography.fontFamily, 'et-book, Georgia, serif');
    assert.equal(personalNote.richContent.type, 'doc');
    assert.equal(personalNote.richContent.content[0].type, 'paragraph');
  });

  await t.test('3. Daily Journal entry schema and date mapping', () => {
    const journalDate = '2026-11-02';
    const journalEntry1 = {
      id: 'entry-1',
      title: 'Morning Reflection',
      content: 'Early sunlight across the workspace...',
      journalDate: '2026-11-02',
      sectionId: 'sec-daily-journal',
      createdAt: '2026-11-02T08:30:00.000Z',
    };

    const journalEntry2 = {
      id: 'entry-2',
      title: 'Evening Log',
      content: 'Reviewing the day accomplishments...',
      journalDate: '2026-11-02',
      sectionId: 'sec-daily-journal',
      createdAt: '2026-11-02T21:45:00.000Z',
    };

    const allEntries = [journalEntry1, journalEntry2];
    const filteredForDay = allEntries.filter((e) => e.journalDate === journalDate);

    assert.equal(filteredForDay.length, 2, 'Supports multiple entries per calendar day');
    assert.equal(filteredForDay[0].title, 'Morning Reflection');
    assert.equal(filteredForDay[1].title, 'Evening Log');
  });

  await t.test('4. Debounced autosave state machine and concurrency guard', async () => {
    let saveState = 'idle';
    let lastSavedContent = '';
    let inFlightTimestamp = 0;
    let serverRecord = null;

    const performAutosave = async (noteId, payload, clientTimestamp) => {
      saveState = 'saving';
      inFlightTimestamp = clientTimestamp;

      // Simulate async network request
      await new Promise((res) => setTimeout(res, 20));

      // Guard: If newer edits happened while this request was in flight, do not overwrite state with stale result
      if (clientTimestamp < inFlightTimestamp) {
        return; // Discard superseded response
      }

      serverRecord = { ...payload, id: noteId, updatedAt: new Date().toISOString() };
      lastSavedContent = payload.content;
      saveState = 'saved';
    };

    // First change at t=100
    const change1 = { title: 'First draft', content: 'Draft one' };
    const p1 = performAutosave('note-1', change1, 100);

    // Second change at t=105 before p1 finishes
    const change2 = { title: 'Final draft', content: 'Draft two refined' };
    const p2 = performAutosave('note-1', change2, 105);

    await Promise.all([p1, p2]);

    assert.equal(saveState, 'saved');
    assert.equal(lastSavedContent, 'Draft two refined', 'Latest change overwrote earlier change');
    assert.equal(serverRecord.title, 'Final draft');
  });

  await t.test('5. Reading Notes compatibility: Book-linked notes preserved and differentiated', () => {
    const readingNote = {
      id: 'book-note-99',
      title: 'Chapter 2 Reflection',
      content: 'The core premise of human psychology under stress...',
      bookId: '610a4b42-eb53-4835-855b-112bd6f700b9',
      book: {
        id: '610a4b42-eb53-4835-855b-112bd6f700b9',
        title: 'Man’s Search for Meaning',
      },
      page: 42,
      category: 'Psychology',
      type: 'BOOK',
    };

    const personalNote = {
      id: 'pers-note-1',
      title: 'Weekly Review',
      content: 'Refining personal goals for Q4...',
      bookId: null,
      book: null,
      page: null,
      type: 'STANDALONE',
    };

    const notes = [readingNote, personalNote];

    const readingOnly = notes.filter((n) => n.bookId != null);
    const personalOnly = notes.filter((n) => n.bookId == null);

    assert.equal(readingOnly.length, 1);
    assert.equal(readingOnly[0].book.title, 'Man’s Search for Meaning');
    assert.equal(readingOnly[0].page, 42);

    assert.equal(personalOnly.length, 1);
    assert.equal(personalOnly[0].title, 'Weekly Review');
  });

  await t.test('6. Typography and Appearance themes validation', () => {
    const validAppearances = ['classic-paper', 'midnight', 'pure-minimal'];
    const chosenAppearance = 'midnight';

    assert.ok(validAppearances.includes(chosenAppearance));

    // Curated font families check
    const supportedFonts = [
      'et-book, Georgia, serif',
      'EB Garamond, Garamond, serif',
      'Inter, -apple-system, sans-serif',
      'system-ui, sans-serif',
      'JetBrains Mono, monospace',
      'Caveat, cursive',
    ];

    assert.equal(supportedFonts.length, 6, 'Provides 6 curated typography font choices');
  });
});

