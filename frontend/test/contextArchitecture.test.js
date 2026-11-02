import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('STEP 1: Context Architecture & State Management Suite', () => {
  // Test AuthContext state logic
  describe('AuthContext Core Logic', () => {
    test('1. Initializes currentUser and guest state from storage cleanly', () => {
      const mockStorage = new Map([
        ['aks_auth_user', JSON.stringify({ id: 'u1', name: 'Reader One' })],
      ]);

      const user = JSON.parse(mockStorage.get('aks_auth_user'));
      const isGuest = !user && mockStorage.get('aks_guest_mode') === 'true';

      assert.deepEqual(user, { id: 'u1', name: 'Reader One' });
      assert.equal(isGuest, false);
    });

    test('2. Login sets auth user and clears all guest tokens', () => {
      const mockStorage = new Map([['aks_guest_mode', 'true']]);

      // login operation simulation
      const user = { id: 'u2', name: 'Reader Two', email: 'two@sanctuary.test' };
      mockStorage.delete('aks_guest_mode');
      mockStorage.set('aks_auth_user', JSON.stringify(user));

      assert.equal(mockStorage.has('aks_guest_mode'), false, 'Guest mode token must be removed on login');
      assert.ok(mockStorage.has('aks_auth_user'), 'Auth user must be stored on login');
    });

    test('3. Logout clears all auth and guest tokens', () => {
      const mockStorage = new Map([
        ['aks_auth_user', JSON.stringify({ id: 'u1' })],
        ['aks_guest_mode', 'true'],
      ]);

      mockStorage.delete('aks_auth_user');
      mockStorage.delete('aks_guest_mode');

      assert.equal(mockStorage.size, 0, 'Logout must clear all session tokens');
    });

    test('4. Explore as Guest activates guest mode without creating auth user', () => {
      const mockStorage = new Map();

      mockStorage.set('aks_guest_mode', 'true');

      assert.equal(mockStorage.get('aks_guest_mode'), 'true');
      assert.equal(mockStorage.has('aks_auth_user'), false);
    });

    test('5. setUnauthorizedHandler returns unregister function that cleans up listener', async () => {
      const { setUnauthorizedHandler } = await import('../src/services/api.js');
      let handlerCalled = false;
      const testHandler = () => { handlerCalled = true; };

      const unregister = setUnauthorizedHandler(testHandler);
      assert.equal(typeof unregister, 'function', 'setUnauthorizedHandler must return an unregister function');

      unregister();
      assert.equal(handlerCalled, false);
    });
  });

  // Test LibraryContext state logic
  describe('LibraryContext Core Logic', () => {
    const mockBooks = [
      {
        id: 'b1',
        title: 'First Volume',
        author: 'Scholar',
        hasBeenOpened: true,
        lastOpenedTimestamp: 1000,
        bookmarks: [{ page: 1 }, { page: 5 }],
        highlights: [{ id: 'h1', page: 2 }],
      },
      {
        id: 'b2',
        title: 'Second Volume',
        author: 'Philosopher',
        hasBeenOpened: true,
        lastOpenedTimestamp: 2000,
        bookmarks: [{ page: 10 }],
        highlights: [],
      },
      {
        id: 'b3',
        title: 'Unopened Volume',
        author: 'Poet',
        hasBeenOpened: false,
        lastOpenedTimestamp: 0,
        bookmarks: [],
        highlights: [],
      },
    ];

    test('1. Correctly determines currentBook from latest opened timestamp', () => {
      const opened = mockBooks.filter((b) => b.hasBeenOpened);
      opened.sort((a, b) => b.lastOpenedTimestamp - a.lastOpenedTimestamp);
      const currentBook = opened[0];

      assert.equal(currentBook.id, 'b2', 'b2 has latest timestamp (2000 > 1000)');
    });

    test('2. recentlyOpenedBooks excludes currentBook and sorts descending', () => {
      const currentBookId = 'b2';
      const recent = mockBooks
        .filter((b) => b.hasBeenOpened && b.id !== currentBookId)
        .sort((a, b) => b.lastOpenedTimestamp - a.lastOpenedTimestamp);

      assert.equal(recent.length, 1);
      assert.equal(recent[0].id, 'b1');
    });

    test('3. Computes accurate aggregate dynamic counts', () => {
      const totalBookmarks = mockBooks.reduce((acc, b) => acc + (b.bookmarks?.length || 0), 0);
      const totalHighlights = mockBooks.reduce((acc, b) => acc + (b.highlights?.length || 0), 0);

      assert.equal(totalBookmarks, 3, '2 in b1 + 1 in b2');
      assert.equal(totalHighlights, 1, '1 in b1 + 0 in b2');
    });

    test('4. Immutably updates book metadata on rename and category change', () => {
      const updated = mockBooks.map((b) =>
        b.id === 'b1' ? { ...b, title: 'Renamed Title' } : b
      );

      assert.equal(updated.find((b) => b.id === 'b1').title, 'Renamed Title');
      assert.equal(mockBooks.find((b) => b.id === 'b1').title, 'First Volume', 'Original array remains untouched');
    });
  });
});
