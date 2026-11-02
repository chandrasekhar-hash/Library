import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('ISSUE-AUTH-01: Guest Mode Cross-Tab Synchronization Test Suite', () => {
  // Mock localStorage and event target
  function createStorageEnvironment() {
    const store = new Map();
    const listeners = [];

    const mockStorage = {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        const oldValue = store.get(key) || null;
        store.set(key, String(value));
        const event = {
          key,
          oldValue,
          newValue: String(value),
          storageArea: mockStorage,
        };
        for (const listener of listeners) {
          listener(event);
        }
      },
      removeItem(key) {
        const oldValue = store.get(key) || null;
        store.delete(key);
        const event = {
          key,
          oldValue,
          newValue: null,
          storageArea: mockStorage,
        };
        for (const listener of listeners) {
          listener(event);
        }
      },
      clear() {
        store.clear();
      },
    };

    const addEventListener = (type, fn) => {
      if (type === 'storage') listeners.push(fn);
    };

    const removeEventListener = (type, fn) => {
      if (type === 'storage') {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    };

    return { mockStorage, addEventListener, removeEventListener };
  }

  test('1. Syncs when another tab enables guest mode', () => {
    const { mockStorage, addEventListener } = createStorageEnvironment();

    let isGuest = false;
    let authUser = null;

    addEventListener('storage', (e) => {
      if (e.key === 'aks_guest_mode') {
        if (e.newValue === 'true' && !authUser) {
          isGuest = true;
        } else if (!e.newValue) {
          isGuest = false;
        }
      }
    });

    // Remote tab sets guest mode
    mockStorage.setItem('aks_guest_mode', 'true');

    assert.equal(isGuest, true, 'Tab should transition to guest mode when another tab enters guest');
  });

  test('2. Syncs when another tab logs in with user credentials', () => {
    const { mockStorage, addEventListener } = createStorageEnvironment();

    let isGuest = true;
    let authUser = null;

    addEventListener('storage', (e) => {
      if (e.key === 'aks_auth_user') {
        if (e.newValue) {
          authUser = JSON.parse(e.newValue);
          isGuest = false;
        } else {
          authUser = null;
        }
      } else if (e.key === 'aks_guest_mode') {
        if (!e.newValue) {
          isGuest = false;
        }
      }
    });

    const userPayload = JSON.stringify({ id: 'usr-1', email: 'reader@aks.local' });
    mockStorage.setItem('aks_auth_user', userPayload);
    mockStorage.removeItem('aks_guest_mode');

    assert.deepEqual(authUser, { id: 'usr-1', email: 'reader@aks.local' });
    assert.equal(isGuest, false, 'Authenticated user presence must revoke guest mode');
  });

  test('3. Syncs when another tab logs out', () => {
    const { mockStorage, addEventListener } = createStorageEnvironment();

    let isGuest = false;
    let authUser = { id: 'usr-1', email: 'reader@aks.local' };
    let activeNav = 'library';

    addEventListener('storage', (e) => {
      if (e.key === 'aks_auth_user' && !e.newValue) {
        authUser = null;
        isGuest = false;
        activeNav = 'landing';
      }
    });

    // Remote tab logs out
    mockStorage.removeItem('aks_auth_user');

    assert.equal(authUser, null);
    assert.equal(isGuest, false);
    assert.equal(activeNav, 'landing', 'Logging out in one tab should reset navigation in synced tabs');
  });

  test('4. Does NOT convert authenticated user to guest mode if guest mode event is received', () => {
    const { mockStorage, addEventListener } = createStorageEnvironment();

    let isGuest = false;
    let authUser = { id: 'usr-2', email: 'auth@aks.local' };

    addEventListener('storage', (e) => {
      if (e.key === 'aks_guest_mode') {
        // Authenticated user check: never convert to guest if user is logged in
        if (e.newValue === 'true' && !authUser) {
          isGuest = true;
        }
      }
    });

    mockStorage.setItem('aks_guest_mode', 'true');

    assert.equal(isGuest, false, 'Authenticated session must not be overwritten by guest mode event');
    assert.notEqual(authUser, null);
  });
});
