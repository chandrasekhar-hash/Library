/**
 * pageTurnSound.test.js
 * Aks (अक्स) — Realistic Page-Flipping Sound Effects Test Suite
 *
 * Validates:
 * 1. Default preference is enabled (pageTurnSound: true).
 * 2. Sanitization preserves boolean values and falls back safely to true.
 * 3. Preference persistence across guest mode and global category updates.
 * 4. Sound service safe execution in test environments (idempotency, volume guards, disabled bypass).
 * 5. Backend preference schema allows and validates pageTurnSound under readingConfig.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  sanitizePreferences,
  getEffectivePreferences,
  updateGlobalCategory,
  PREFERENCES_STORAGE_KEY,
} from '../src/services/preferencesService.js';
import {
  playPageTurnSound,
  preloadPageTurnSound,
  stopPageTurnSound,
  cleanupSoundService,
} from '../src/services/soundService.js';
import {
  DEFAULT_USER_PREFERENCES,
  ALLOWED_KEYS_BY_CATEGORY,
} from '../../backend/src/config/preferences.js';

describe('Aks — Page-Flipping Sound Effects Suite', () => {
  beforeEach(() => {
    // Reset global localStorage mock if present in test environment
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.clear();
    }
  });

  describe('1. Default Preferences & Schema', () => {
    it('enables page-turning sound by default in frontend DEFAULT_PREFERENCES', () => {
      assert.strictEqual(
        DEFAULT_PREFERENCES.global.reading.pageTurnSound,
        true,
        'pageTurnSound must be true by default for new users'
      );
    });

    it('enables pageTurnSound by default in backend DEFAULT_USER_PREFERENCES', () => {
      assert.strictEqual(
        DEFAULT_USER_PREFERENCES.readingConfig.pageTurnSound,
        true,
        'Backend readingConfig.pageTurnSound must default to true'
      );
    });

    it('includes pageTurnSound in backend ALLOWED_KEYS_BY_CATEGORY.reading', () => {
      assert.ok(
        ALLOWED_KEYS_BY_CATEGORY.reading.includes('pageTurnSound'),
        'ALLOWED_KEYS_BY_CATEGORY.reading must contain pageTurnSound'
      );
    });
  });

  describe('2. Preference Sanitization & Effective Resolution', () => {
    it('preserves pageTurnSound: true when explicitly set', () => {
      const sanitized = sanitizePreferences({
        global: {
          reading: {
            pageTurnSound: true,
          },
        },
      });
      assert.strictEqual(sanitized.global.reading.pageTurnSound, true);
    });

    it('preserves pageTurnSound: false when explicitly disabled by the user', () => {
      const sanitized = sanitizePreferences({
        global: {
          reading: {
            pageTurnSound: false,
          },
        },
      });
      assert.strictEqual(sanitized.global.reading.pageTurnSound, false);
    });

    it('falls back to true when pageTurnSound is non-boolean or missing', () => {
      const sanitizedMissing = sanitizePreferences({
        global: {
          reading: {},
        },
      });
      assert.strictEqual(sanitizedMissing.global.reading.pageTurnSound, true);

      const sanitizedInvalid = sanitizePreferences({
        global: {
          reading: {
            pageTurnSound: 'invalid-string',
          },
        },
      });
      assert.strictEqual(sanitizedInvalid.global.reading.pageTurnSound, true);
    });

    it('resolves effective preferences with pageTurnSound for book sessions', () => {
      // Mock localStorage for node test
      const store = {};
      const mockStorage = {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
      const origStorage = globalThis.localStorage;
      globalThis.localStorage = mockStorage;

      try {
        // Test default
        const effective = getEffectivePreferences('book-123');
        assert.strictEqual(effective.reading.pageTurnSound, true);

        // Update to disabled
        updateGlobalCategory('reading', { pageTurnSound: false });
        const effectiveDisabled = getEffectivePreferences('book-123');
        assert.strictEqual(effectiveDisabled.reading.pageTurnSound, false);

        // Update back to enabled
        updateGlobalCategory('reading', { pageTurnSound: true });
        const effectiveReenabled = getEffectivePreferences('book-123');
        assert.strictEqual(effectiveReenabled.reading.pageTurnSound, true);
      } finally {
        globalThis.localStorage = origStorage;
      }
    });
  });

  describe('3. Sound Service & Audio Life-cycle Safeguards', () => {
    it('returns false immediately when enabled is false', async () => {
      const played = await playPageTurnSound({ enabled: false });
      assert.strictEqual(played, false, 'Disabled sound must return false and remain silent');
    });

    it('does not crash in non-browser Node.js environment when invoked', async () => {
      const played = await playPageTurnSound({ enabled: true });
      // In Node.js environment, window is undefined so it gracefully returns false
      assert.strictEqual(played, false);
    });

    it('handles preload idempotently in test environment without errors', async () => {
      await assert.doesNotReject(async () => {
        await preloadPageTurnSound();
        await preloadPageTurnSound();
      }, 'Preload must be idempotent and safely handle non-DOM environment');
    });

    it('safely handles stop and cleanup in test environment', () => {
      assert.doesNotThrow(() => {
        stopPageTurnSound();
        cleanupSoundService();
      });
    });
  });
});
