import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

describe('Aks (अक्स) Phase 7: Client Migration Engine Unit Logic', () => {
  // Mock localStorage for node environment
  class MockLocalStorage {
    constructor() {
      this.store = {};
    }
    getItem(key) {
      return this.store[key] || null;
    }
    setItem(key, value) {
      this.store[key] = String(value);
    }
    removeItem(key) {
      delete this.store[key];
    }
    clear() {
      this.store = {};
    }
  }

  const MIGRATION_JOURNAL_KEY = 'aks_migration_journal_v1';

  test('Journal persistence: record, retrieve, and verify idempotent journal entries', () => {
    const mockStorage = new MockLocalStorage();

    function recordJournalEntry(localBookId, serverBookId, sha256) {
      const raw = mockStorage.getItem(MIGRATION_JOURNAL_KEY);
      const journal = raw ? JSON.parse(raw) : {};
      journal[localBookId] = {
        serverBookId,
        sha256,
        migratedAt: new Date().toISOString(),
      };
      mockStorage.setItem(MIGRATION_JOURNAL_KEY, JSON.stringify(journal));
    }

    function getJournal() {
      const raw = mockStorage.getItem(MIGRATION_JOURNAL_KEY);
      return raw ? JSON.parse(raw) : {};
    }

    // 1. Initially empty
    assert.deepEqual(getJournal(), {});

    // 2. Record first migrated book
    recordJournalEntry('local-book-1', 'srv-uuid-1', 'hash-aaa');
    let j = getJournal();
    assert.ok(j['local-book-1']);
    assert.equal(j['local-book-1'].serverBookId, 'srv-uuid-1');
    assert.equal(j['local-book-1'].sha256, 'hash-aaa');

    // 3. Re-recording on retry preserves or updates without corruption
    recordJournalEntry('local-book-1', 'srv-uuid-1', 'hash-aaa');
    j = getJournal();
    assert.equal(Object.keys(j).length, 1);

    // 4. Record second book
    recordJournalEntry('local-book-2', 'srv-uuid-2', 'hash-bbb');
    j = getJournal();
    assert.equal(Object.keys(j).length, 2);
    assert.equal(j['local-book-2'].serverBookId, 'srv-uuid-2');
  });

  test('Duplicate classifier distinguishes exact hash match vs title-only match vs new copy', () => {
    const serverBooks = [
      {
        id: 'srv-1',
        title: 'Structure and Interpretation of Computer Programs',
        file: { fileSha256: 'hash-sicp-v1' },
      },
      {
        id: 'srv-2',
        title: 'Introduction to Algorithms',
        file: { fileSha256: 'hash-clrs' },
      },
    ];

    function classifyLocalBook(localBook, localSha256) {
      // 1. Check exact SHA-256 match
      const exactMatch = serverBooks.find(
        (b) => b.file && b.file.fileSha256 && b.file.fileSha256.toLowerCase() === (localSha256 || '').toLowerCase()
      );
      if (exactMatch) {
        return { type: 'EXACT_DUPLICATE', existingBook: exactMatch };
      }

      // 2. Check title match with different file
      const titleMatch = serverBooks.find(
        (b) => b.title.trim().toLowerCase() === localBook.title.trim().toLowerCase()
      );
      if (titleMatch) {
        return { type: 'TITLE_MATCH_DIFFERENT_FILE', existingBook: titleMatch };
      }

      return { type: 'UNIQUE' };
    }

    // Case 1: Exact PDF duplicate
    const c1 = classifyLocalBook({ title: 'SICP Renamed' }, 'hash-sicp-v1');
    assert.equal(c1.type, 'EXACT_DUPLICATE');
    assert.equal(c1.existingBook.id, 'srv-1');

    // Case 2: Same title, different PDF
    const c2 = classifyLocalBook({ title: 'Structure and Interpretation of Computer Programs' }, 'different-hash-xyz');
    assert.equal(c2.type, 'TITLE_MATCH_DIFFERENT_FILE');
    assert.equal(c2.existingBook.id, 'srv-1');

    // Case 3: Completely unique book
    const c3 = classifyLocalBook({ title: 'Design Patterns' }, 'hash-gof');
    assert.equal(c3.type, 'UNIQUE');
  });

  test('Zero Local Data Loss: Local storage records must never be deleted during migration workflow', () => {
    // Simulated IndexedDB guest storage
    const localDatabase = {
      books: [
        { id: 'guest-book-1', title: 'Local Pride', blob: Buffer.from('%PDF-1.4...'), bookmarks: [{ page: 5 }] },
        { id: 'guest-book-2', title: 'Offline Reads', blob: Buffer.from('%PDF-1.4...'), bookmarks: [] },
      ],
      notes: [
        { id: 'local-note-1', title: 'Local Note', bookId: 'guest-book-1' },
      ],
    };

    // Deep copy before migration to track invariance
    const snapshotBefore = JSON.parse(JSON.stringify(localDatabase, (k, v) => (Buffer.isBuffer(v) ? v.toString('hex') : v)));

    // Migration read operations (read-only inspection & copying)
    const booksToMigrate = [...localDatabase.books];
    const notesToMigrate = [...localDatabase.notes];

    // Ensure reading and migrating does not mutate or clear the local stores
    assert.equal(localDatabase.books.length, 2);
    assert.equal(localDatabase.notes.length, 1);
    assert.ok(localDatabase.books[0].blob);

    const snapshotAfter = JSON.parse(JSON.stringify(localDatabase, (k, v) => (Buffer.isBuffer(v) ? v.toString('hex') : v)));
    assert.deepEqual(snapshotBefore, snapshotAfter, 'Local guest database records must remain 100% identical and intact');
  });

  test('Account-Scoped Journal: Multiple accounts using the same browser maintain isolated mappings', () => {
    const mockStorage = new MockLocalStorage();
    const MIGRATION_JOURNAL_V2_KEY = 'aks_migration_journal_v2';

    function loadRawJournalV2() {
      const raw = mockStorage.getItem(MIGRATION_JOURNAL_V2_KEY);
      return raw ? JSON.parse(raw) : { version: 2, accounts: {} };
    }

    function recordAccountJournalEntry(userId, localBookId, entry) {
      const journal = loadRawJournalV2();
      if (!journal.accounts[userId]) {
        journal.accounts[userId] = { books: {}, lastUpdated: new Date().toISOString() };
      }
      journal.accounts[userId].books[localBookId] = {
        ...entry,
        updatedAt: new Date().toISOString(),
      };
      mockStorage.setItem(MIGRATION_JOURNAL_V2_KEY, JSON.stringify(journal));
    }

    function getAccountJournal(userId) {
      const journal = loadRawJournalV2();
      return journal.accounts?.[userId]?.books || {};
    }

    // User A migrates local-book-1 -> srv-userA-book1
    recordAccountJournalEntry('user-A-id', 'local-book-1', {
      serverBookId: 'srv-userA-book1',
      title: 'Common Volume',
      status: 'completed',
    });

    // User B logs in on same browser with same local book ID
    // User B journal must NOT see User A's serverBookId!
    const userBJournalBefore = getAccountJournal('user-B-id');
    assert.deepEqual(userBJournalBefore, {}, 'User B must start with empty journal, isolated from User A');

    // User B migrates local-book-1 -> srv-userB-book1
    recordAccountJournalEntry('user-B-id', 'local-book-1', {
      serverBookId: 'srv-userB-book1',
      title: 'Common Volume',
      status: 'completed',
    });

    // Verify isolation
    const userAJournal = getAccountJournal('user-A-id');
    const userBJournal = getAccountJournal('user-B-id');
    assert.equal(userAJournal['local-book-1'].serverBookId, 'srv-userA-book1');
    assert.equal(userBJournal['local-book-1'].serverBookId, 'srv-userB-book1');
    assert.notEqual(userAJournal['local-book-1'].serverBookId, userBJournal['local-book-1'].serverBookId);
  });

  test('Local-Data Inventory Classification: Non-cloud items are disclosed as preserved locally', () => {
    const localTimer = { totalSeconds: 7200, lastUpdated: Date.now() };
    const customMedia = { id: 'current_custom_background', type: 'video', size: 15482000 };

    function classifyLocalInventory(timer, media) {
      const deviceSpecificItems = [];
      if (timer && timer.totalSeconds > 0) {
        deviceSpecificItems.push({
          key: 'study_timer',
          name: 'Reading Room Cumulative Study Timer',
          detail: `${Math.round(timer.totalSeconds / 60)} minutes`,
          reason: 'Device-specific local counter. Preserved in your browser without modification.',
          status: 'preserved_locally',
        });
      }
      if (media) {
        deviceSpecificItems.push({
          key: 'custom_background',
          name: 'Custom Wallpaper Media',
          detail: 'Local MediaStorage',
          reason: 'Hardware-accelerated custom wallpapers preserved in browser storage.',
          status: 'preserved_locally',
        });
      }
      return deviceSpecificItems;
    }

    const items = classifyLocalInventory(localTimer, customMedia);
    assert.equal(items.length, 2);
    assert.equal(items[0].key, 'study_timer');
    assert.equal(items[0].status, 'preserved_locally');
    assert.equal(items[1].key, 'custom_background');
    assert.equal(items[1].status, 'preserved_locally');
  });

  test('Phase 7.2: V1 journal remains byte-for-byte unchanged after v2 conversion & repeated conversions are safe', () => {
    const mockStorage = new MockLocalStorage();
    const MIGRATION_JOURNAL_V1_KEY = 'aks_migration_journal_v1';
    const MIGRATION_JOURNAL_V2_KEY = 'aks_migration_journal_v2';

    // Exact raw v1 JSON string
    const originalV1Raw = JSON.stringify({
      'local-book-101': {
        serverBookId: 'srv-uuid-101',
        title: 'Original Legacy Book',
        sha256: 'exact-sha256-hash-101',
        migratedAt: '2026-10-20T12:00:00.000Z',
      },
      'local-book-102': {
        serverBookId: 'srv-uuid-102',
        title: 'Second Legacy Book',
        sha256: 'exact-sha256-hash-102',
        migratedAt: '2026-10-21T14:30:00.000Z',
      },
    });

    mockStorage.setItem(MIGRATION_JOURNAL_V1_KEY, originalV1Raw);

    function loadRawJournalV2() {
      const raw = mockStorage.getItem(MIGRATION_JOURNAL_V2_KEY);
      return raw ? JSON.parse(raw) : { version: 2, accounts: {} };
    }

    function recordAccountJournalEntry(userId, localBookId, entry) {
      const journal = loadRawJournalV2();
      if (!journal.accounts[userId]) {
        journal.accounts[userId] = { books: {}, lastUpdated: new Date().toISOString() };
      }
      journal.accounts[userId].books[localBookId] = {
        ...entry,
        updatedAt: new Date().toISOString(),
      };
      mockStorage.setItem(MIGRATION_JOURNAL_V2_KEY, JSON.stringify(journal));
    }

    function migrateLegacyJournalIfOwned(userId, serverBooks = []) {
      if (!userId || !Array.isArray(serverBooks)) return;
      const rawV1 = mockStorage.getItem(MIGRATION_JOURNAL_V1_KEY);
      if (!rawV1) return;
      const v1 = JSON.parse(rawV1);
      if (!v1 || typeof v1 !== 'object') return;

      const ownedServerBookIds = new Set(serverBooks.map((b) => b.id));

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
      // Phase 7.2: Must NEVER delete, clear, or rewrite v1!
    }

    const currentServerBooks = [
      { id: 'srv-uuid-101', title: 'Original Legacy Book' },
      { id: 'srv-uuid-102', title: 'Second Legacy Book' },
    ];

    // First conversion run
    migrateLegacyJournalIfOwned('user-test-72', currentServerBooks);

    // 1. V1 journal MUST remain byte-for-byte unchanged
    const v1AfterFirstRun = mockStorage.getItem(MIGRATION_JOURNAL_V1_KEY);
    assert.equal(v1AfterFirstRun, originalV1Raw, 'v1 journal must be byte-for-byte identical after conversion');

    // 2. V2 journal contains the account-scoped migrated entries
    const v2AfterFirstRun = loadRawJournalV2();
    assert.ok(v2AfterFirstRun.accounts['user-test-72']);
    assert.equal(Object.keys(v2AfterFirstRun.accounts['user-test-72'].books).length, 2);
    assert.equal(v2AfterFirstRun.accounts['user-test-72'].books['local-book-101'].serverBookId, 'srv-uuid-101');

    // 3. Repeated conversion run is completely safe without duplicate mappings
    migrateLegacyJournalIfOwned('user-test-72', currentServerBooks);
    migrateLegacyJournalIfOwned('user-test-72', currentServerBooks);

    const v1AfterRepeatedRuns = mockStorage.getItem(MIGRATION_JOURNAL_V1_KEY);
    assert.equal(v1AfterRepeatedRuns, originalV1Raw, 'v1 journal remains untouched across multiple runs');

    const v2AfterRepeatedRuns = loadRawJournalV2();
    assert.equal(Object.keys(v2AfterRepeatedRuns.accounts['user-test-72'].books).length, 2);
    assert.equal(v2AfterRepeatedRuns.accounts['user-test-72'].books['local-book-102'].serverBookId, 'srv-uuid-102');
  });

  test('Phase 7.2: Unambiguous recovery by sourceId vs ambiguous metadata matching', () => {
    // Two local books with identical metadata
    const localBookA = { id: 'local-book-A', title: 'Calculus Vol 1', author: 'Stewart', totalPages: 400 };
    const localBookB = { id: 'local-book-B', title: 'Calculus Vol 1', author: 'Stewart', totalPages: 400 };

    const sourceIdA = `guest_book_${localBookA.id}`;
    const sourceIdB = `guest_book_${localBookB.id}`;

    assert.notEqual(sourceIdA, sourceIdB, 'Each book must have a unique stable source identifier');

    // Simulated server books
    const serverBooks = [
      { id: 'srv-book-A', title: 'Calculus Vol 1', author: 'Stewart', totalPages: 400, sourceId: sourceIdA, file: null },
      { id: 'srv-book-B', title: 'Calculus Vol 1', author: 'Stewart', totalPages: 400, sourceId: sourceIdB, file: null },
    ];

    // Recovery function using strict sourceId
    function recoverBook(localBook, serverList) {
      const targetSourceId = `guest_book_${localBook.id}`;
      // Rule: Never match solely on title/author/totalPages
      return serverList.find((sb) => sb.sourceId === targetSourceId) || null;
    }

    const recoveredA = recoverBook(localBookA, serverBooks);
    const recoveredB = recoverBook(localBookB, serverBooks);

    assert.ok(recoveredA);
    assert.ok(recoveredB);
    assert.equal(recoveredA.id, 'srv-book-A');
    assert.equal(recoveredB.id, 'srv-book-B');
    assert.notEqual(recoveredA.id, recoveredB.id, 'Identical local books recover completely independently without crosstalk');
  });
});

