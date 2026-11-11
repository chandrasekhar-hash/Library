import { prisma } from '../services/prisma.js';
import { isValidUuid } from '../utils/validators.js';
import { withUserLock } from '../utils/userLock.js';
import {
  DEFAULT_USER_PREFERENCES,
  VALID_MODES,
  VALID_ANIMATION_SPEEDS,
  VALID_LAYOUTS,
  VALID_SCROLL_DIRS,
  VALID_SCROLL_BEHAVIORS,
  VALID_FULLSCREEN_PREFS,
  VALID_FONT_FAMILIES,
  VALID_MARGINS,
  VALID_THEMES,
  VALID_BG_MODES,
  VALID_BG_SCOPES,
  VALID_BG_INTENSITIES,
  VALID_MOODS,
  VALID_POSITIONING,
  VALID_MARKERS,
  VALID_ANNOTATION_COLORS,
  VALID_CATEGORIES,
  ALLOWED_CATEGORIES,
  ALLOWED_KEYS_BY_CATEGORY,
} from '../config/preferences.js';

export { DEFAULT_USER_PREFERENCES };

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeUserPreference(pref, userId) {
  if (!pref) {
    return {
      id: null,
      userId,
      readingConfig: { ...DEFAULT_USER_PREFERENCES.readingConfig },
      typographyConfig: { ...DEFAULT_USER_PREFERENCES.typographyConfig },
      annotationsConfig: { ...DEFAULT_USER_PREFERENCES.annotationsConfig },
      atmosphereConfig: { ...DEFAULT_USER_PREFERENCES.atmosphereConfig },
      storageConfig: { ...DEFAULT_USER_PREFERENCES.storageConfig },
      studyTimeResetAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    id: pref.id,
    userId: pref.userId,
    readingConfig: pref.readingConfig || { ...DEFAULT_USER_PREFERENCES.readingConfig },
    typographyConfig: pref.typographyConfig || { ...DEFAULT_USER_PREFERENCES.typographyConfig },
    annotationsConfig: pref.annotationsConfig || { ...DEFAULT_USER_PREFERENCES.annotationsConfig },
    atmosphereConfig: pref.atmosphereConfig || { ...DEFAULT_USER_PREFERENCES.atmosphereConfig },
    storageConfig: pref.storageConfig || { ...DEFAULT_USER_PREFERENCES.storageConfig },
    studyTimeResetAt: pref.studyTimeResetAt,
    createdAt: pref.createdAt,
    updatedAt: pref.updatedAt,
  };
}

/**
 * Validates updates to preferences against schema constraints.
 * Rejects unknown root and nested keys, prototype-pollution attempts, and invalid values.
 * Throws an Error with statusCode: 400 and code: 'INVALID_PREFERENCE' or 'INVALID_PREFERENCE_KEY'.
 */
export function validatePreferenceUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    const err = new Error('Preference payload must be a non-null object.');
    err.statusCode = 400;
    err.code = 'INVALID_PREFERENCE';
    throw err;
  }

  // Check root keys
  for (const rootKey of Object.keys(updates)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(rootKey)) {
      const err = new Error(`Malicious or invalid property key: ${rootKey}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE_KEY';
      throw err;
    }

    if (!ALLOWED_CATEGORIES.includes(rootKey)) {
      const err = new Error(`Invalid preference category: ${rootKey}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE_KEY';
      throw err;
    }

    const catObj = updates[rootKey];
    if (catObj !== undefined && catObj !== null) {
      if (typeof catObj !== 'object' || Array.isArray(catObj)) {
        const err = new Error(`Category ${rootKey} must be an object.`);
        err.statusCode = 400;
        err.code = 'INVALID_PREFERENCE_VALUE';
        throw err;
      }

      // Determine category canonical key
      let canonicalCat = rootKey;
      if (rootKey.endsWith('Config')) {
        canonicalCat = rootKey.replace('Config', '');
      }
      const allowedProps = ALLOWED_KEYS_BY_CATEGORY[canonicalCat] || [];

      // Validate all nested keys within the category
      for (const nestedKey of Object.keys(catObj)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(nestedKey)) {
          const err = new Error(`Malicious or invalid property key: ${nestedKey}`);
          err.statusCode = 400;
          err.code = 'INVALID_PREFERENCE_KEY';
          throw err;
        }

        if (!allowedProps.includes(nestedKey)) {
          const err = new Error(`Unknown preference setting: ${rootKey}.${nestedKey}`);
          err.statusCode = 400;
          err.code = 'INVALID_PREFERENCE_KEY';
          throw err;
        }
      }
    }
  }

  // 1. Reading Configuration
  const reading = updates.readingConfig || updates.reading;
  if (reading && typeof reading === 'object') {
    if (reading.defaultMode !== undefined && !VALID_MODES.includes(reading.defaultMode)) {
      const err = new Error(`Invalid defaultMode. Allowed: ${VALID_MODES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.pageTurnAnimation !== undefined && typeof reading.pageTurnAnimation !== 'boolean') {
      const err = new Error('pageTurnAnimation must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.animationSpeed !== undefined && !VALID_ANIMATION_SPEEDS.includes(reading.animationSpeed)) {
      const err = new Error(`Invalid animationSpeed. Allowed: ${VALID_ANIMATION_SPEEDS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.layout !== undefined && !VALID_LAYOUTS.includes(reading.layout)) {
      const err = new Error(`Invalid layout. Allowed: ${VALID_LAYOUTS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.scrollDirection !== undefined && !VALID_SCROLL_DIRS.includes(reading.scrollDirection)) {
      const err = new Error(`Invalid scrollDirection. Allowed: ${VALID_SCROLL_DIRS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.scrollBehavior !== undefined && !VALID_SCROLL_BEHAVIORS.includes(reading.scrollBehavior)) {
      const err = new Error(`Invalid scrollBehavior. Allowed: ${VALID_SCROLL_BEHAVIORS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.fullscreenPreference !== undefined && !VALID_FULLSCREEN_PREFS.includes(reading.fullscreenPreference)) {
      const err = new Error(`Invalid fullscreenPreference. Allowed: ${VALID_FULLSCREEN_PREFS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.distractionFree !== undefined && typeof reading.distractionFree !== 'boolean') {
      const err = new Error('distractionFree must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (reading.pageTurnSound !== undefined && typeof reading.pageTurnSound !== 'boolean') {
      const err = new Error('pageTurnSound must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
  }

  // 2. Typography Configuration
  const typography = updates.typographyConfig || updates.typography;
  if (typography && typeof typography === 'object') {
    if (typography.fontFamily !== undefined && !VALID_FONT_FAMILIES.includes(typography.fontFamily)) {
      const err = new Error(`Invalid fontFamily. Allowed: ${VALID_FONT_FAMILIES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (typography.fontSize !== undefined) {
      const fs = Number(typography.fontSize);
      if (isNaN(fs) || fs < 12 || fs > 28) {
        const err = new Error('fontSize must be a number between 12 and 28.');
        err.statusCode = 400;
        err.code = 'INVALID_PREFERENCE';
        throw err;
      }
    }
    if (typography.lineHeight !== undefined) {
      const lh = Number(typography.lineHeight);
      if (isNaN(lh) || lh < 1.3 || lh > 2.2) {
        const err = new Error('lineHeight must be a number between 1.3 and 2.2.');
        err.statusCode = 400;
        err.code = 'INVALID_PREFERENCE';
        throw err;
      }
    }
    if (typography.margins !== undefined && !VALID_MARGINS.includes(typography.margins)) {
      const err = new Error(`Invalid margins. Allowed: ${VALID_MARGINS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (typography.surfaceTheme !== undefined && !VALID_THEMES.includes(typography.surfaceTheme)) {
      const err = new Error(`Invalid surfaceTheme. Allowed: ${VALID_THEMES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
  }

  // 3. Annotations Configuration
  const annotations = updates.annotationsConfig || updates.annotations;
  if (annotations && typeof annotations === 'object') {
    if (annotations.defaultMarker !== undefined && !VALID_MARKERS.includes(annotations.defaultMarker)) {
      const err = new Error(`Invalid defaultMarker. Allowed: ${VALID_MARKERS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.markerColor !== undefined && !VALID_ANNOTATION_COLORS.includes(annotations.markerColor.toLowerCase())) {
      const err = new Error(`Invalid markerColor. Allowed: ${VALID_ANNOTATION_COLORS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.defaultHighlightColor !== undefined && !VALID_ANNOTATION_COLORS.includes(annotations.defaultHighlightColor.toLowerCase())) {
      const err = new Error(`Invalid defaultHighlightColor. Allowed: ${VALID_ANNOTATION_COLORS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.showTimestamps !== undefined && typeof annotations.showTimestamps !== 'boolean') {
      const err = new Error('showTimestamps must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.autoOpenDrawer !== undefined && typeof annotations.autoOpenDrawer !== 'boolean') {
      const err = new Error('autoOpenDrawer must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.defaultCategory !== undefined && !VALID_CATEGORIES.includes(annotations.defaultCategory)) {
      const err = new Error(`Invalid defaultCategory. Allowed: ${VALID_CATEGORIES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.customMarkerUrl !== undefined && annotations.customMarkerUrl !== null && typeof annotations.customMarkerUrl !== 'string') {
      const err = new Error('customMarkerUrl must be a string or null.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (annotations.customMarkerId !== undefined && annotations.customMarkerId !== null && typeof annotations.customMarkerId !== 'string') {
      const err = new Error('customMarkerId must be a string or null.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
  }

  // 4. Atmosphere Configuration
  const atmosphere = updates.atmosphereConfig || updates.atmosphere;
  if (atmosphere && typeof atmosphere === 'object') {
    if (atmosphere.backgroundMode !== undefined && !VALID_BG_MODES.includes(atmosphere.backgroundMode)) {
      const err = new Error(`Invalid backgroundMode. Allowed: ${VALID_BG_MODES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (atmosphere.currentMoodId !== undefined && !VALID_MOODS.includes(atmosphere.currentMoodId)) {
      const err = new Error(`Invalid currentMoodId. Allowed: ${VALID_MOODS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (atmosphere.backgroundScope !== undefined && !VALID_BG_SCOPES.includes(atmosphere.backgroundScope)) {
      const err = new Error(`Invalid backgroundScope. Allowed: ${VALID_BG_SCOPES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (atmosphere.backgroundIntensity !== undefined && !VALID_BG_INTENSITIES.includes(atmosphere.backgroundIntensity)) {
      const err = new Error(`Invalid backgroundIntensity. Allowed: ${VALID_BG_INTENSITIES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (atmosphere.backgroundDimming !== undefined) {
      const dim = Number(atmosphere.backgroundDimming);
      if (isNaN(dim) || dim < 0 || dim > 80) {
        const err = new Error('backgroundDimming must be a number between 0 and 80.');
        err.statusCode = 400;
        err.code = 'INVALID_PREFERENCE';
        throw err;
      }
    }
    if (atmosphere.blurIntensity !== undefined) {
      const blur = Number(atmosphere.blurIntensity);
      if (isNaN(blur) || blur < 0 || blur > 20) {
        const err = new Error('blurIntensity must be a number between 0 and 20.');
        err.statusCode = 400;
        err.code = 'INVALID_PREFERENCE';
        throw err;
      }
    }
    if (atmosphere.positioning !== undefined && !VALID_POSITIONING.includes(atmosphere.positioning)) {
      const err = new Error(`Invalid positioning. Allowed: ${VALID_POSITIONING.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (atmosphere.motionEnabled !== undefined && typeof atmosphere.motionEnabled !== 'boolean') {
      const err = new Error('motionEnabled must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (atmosphere.customMediaId !== undefined && atmosphere.customMediaId !== null && typeof atmosphere.customMediaId !== 'string') {
      const err = new Error('customMediaId must be a string or null.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
  }

  // 5. Storage Configuration
  const storage = updates.storageConfig || updates.storage;
  if (storage && typeof storage === 'object') {
    if (storage.autoSaveProgress !== undefined && typeof storage.autoSaveProgress !== 'boolean') {
      const err = new Error('autoSaveProgress must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
    if (storage.autoSaveNotes !== undefined && typeof storage.autoSaveNotes !== 'boolean') {
      const err = new Error('autoSaveNotes must be a boolean.');
      err.statusCode = 400;
      err.code = 'INVALID_PREFERENCE';
      throw err;
    }
  }
}

/**
 * Deep merge helper for nested preference configurations.
 * - Protects against prototype pollution keys (__proto__, constructor, prototype).
 * - Replaces arrays atomically.
 * - Preserves explicit null values (nullable clearing).
 */
export function mergeConfigs(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;

  for (const key of Object.keys(source)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;

    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null
    ) {
      output[key] = mergeConfigs(target[key], source[key]);
    } else if (source[key] !== undefined) {
      output[key] = source[key];
    }
  }
  return output;
}

/**
 * Verifies that any asset ID referenced in preferences actually exists and belongs to the user.
 */
async function verifyReferencedAssets(userId, updates) {
  const atmo = updates.atmosphereConfig || updates.atmosphere;
  if (atmo && atmo.customMediaId) {
    if (!isValidUuid(atmo.customMediaId)) {
      const err = new Error('Invalid customMediaId format. Expected UUID.');
      err.statusCode = 400;
      err.code = 'INVALID_ID_FORMAT';
      throw err;
    }
    const asset = await prisma.userAsset.findFirst({
      where: { id: atmo.customMediaId, userId, isActive: true },
    });
    if (!asset) {
      const err = new Error('Referenced background asset does not exist or is not owned by user.');
      err.statusCode = 404;
      err.code = 'ASSET_NOT_FOUND';
      throw err;
    }
  }

  const annotations = updates.annotationsConfig || updates.annotations;
  if (annotations && annotations.customMarkerId) {
    if (!isValidUuid(annotations.customMarkerId)) {
      const err = new Error('Invalid customMarkerId format. Expected UUID.');
      err.statusCode = 400;
      err.code = 'INVALID_ID_FORMAT';
      throw err;
    }
    const asset = await prisma.userAsset.findFirst({
      where: { id: annotations.customMarkerId, userId, isActive: true },
    });
    if (!asset) {
      const err = new Error('Referenced marker asset does not exist or is not owned by user.');
      err.statusCode = 404;
      err.code = 'ASSET_NOT_FOUND';
      throw err;
    }
  }
}

/**
 * GET /api/preferences
 * Retrieve authenticated user's global reading preferences.
 * Returns sensible defaults if no record exists yet.
 */
export async function getGlobalPreferences(req, res, next) {
  try {
    const userId = req.resourceUserId || req.userId;

    const preference = await prisma.userPreference.findUnique({
      where: { userId },
    });

    return res.status(200).json({
      preferences: sanitizeUserPreference(preference, userId),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/preferences
 * Partially update authenticated user's global preferences.
 * Serialized per user via withUserLock to prevent race conditions with asset deletion.
 */
export async function updateGlobalPreferences(req, res, next) {
  try {
    const userId = req.userId;
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: {
          message: 'No preference updates were provided in the request body.',
          code: 'NO_UPDATES_PROVIDED',
        },
      });
    }

    // Validate inputs against strict schema
    validatePreferenceUpdates(updates);

    return await withUserLock(userId, async () => {
      // Verify any referenced assets
      await verifyReferencedAssets(userId, updates);

      // Fetch existing preferences or fallback to defaults
      const existing = await prisma.userPreference.findUnique({
        where: { userId },
      });

      const currentReading = existing?.readingConfig || DEFAULT_USER_PREFERENCES.readingConfig;
      const currentTypography = existing?.typographyConfig || DEFAULT_USER_PREFERENCES.typographyConfig;
      const currentAnnotations = existing?.annotationsConfig || DEFAULT_USER_PREFERENCES.annotationsConfig;
      const currentAtmosphere = existing?.atmosphereConfig || DEFAULT_USER_PREFERENCES.atmosphereConfig;
      const currentStorage = existing?.storageConfig || DEFAULT_USER_PREFERENCES.storageConfig;

      const newReading = mergeConfigs(currentReading, updates.readingConfig || updates.reading);
      const newTypography = mergeConfigs(currentTypography, updates.typographyConfig || updates.typography);
      const newAnnotations = mergeConfigs(currentAnnotations, updates.annotationsConfig || updates.annotations);
      const newAtmosphere = mergeConfigs(currentAtmosphere, updates.atmosphereConfig || updates.atmosphere);
      const newStorage = mergeConfigs(currentStorage, updates.storageConfig || updates.storage);

      const saved = await prisma.userPreference.upsert({
        where: { userId },
        update: {
          readingConfig: newReading,
          typographyConfig: newTypography,
          annotationsConfig: newAnnotations,
          atmosphereConfig: newAtmosphere,
          storageConfig: newStorage,
        },
        create: {
          userId,
          readingConfig: newReading,
          typographyConfig: newTypography,
          annotationsConfig: newAnnotations,
          atmosphereConfig: newAtmosphere,
          storageConfig: newStorage,
        },
      });

      return res.status(200).json({
        message: 'Preferences updated successfully.',
        preferences: sanitizeUserPreference(saved, userId),
      });
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: {
          message: err.message,
          code: err.code || 'INVALID_PREFERENCE',
        },
      });
    }
    next(err);
  }
}

/**
 * GET /api/books/:bookId/preferences
 * Retrieve per-book preferences along with computed effective preferences.
 */
export async function getBookPreferences(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.resourceUserId || req.userId;

    if (!isValidUuid(bookId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid book ID format.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    // Verify book ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const [bookPref, globalPref] = await Promise.all([
      prisma.bookPreference.findUnique({
        where: { bookId_userId: { bookId, userId } },
      }),
      prisma.userPreference.findUnique({
        where: { userId },
      }),
    ]);

    const globalSanitized = sanitizeUserPreference(globalPref, userId);
    const overrides = (bookPref?.config && typeof bookPref.config === 'object') ? bookPref.config : {};

    // Compute effective preferences: Global defaults overridden by volume-specific settings
    const effective = {
      reading: mergeConfigs(globalSanitized.readingConfig, overrides.readingConfig || overrides.reading),
      typography: mergeConfigs(globalSanitized.typographyConfig, overrides.typographyConfig || overrides.typography),
      annotations: mergeConfigs(globalSanitized.annotationsConfig, overrides.annotationsConfig || overrides.annotations),
      atmosphere: mergeConfigs(globalSanitized.atmosphereConfig, overrides.atmosphereConfig || overrides.atmosphere),
      storage: mergeConfigs(globalSanitized.storageConfig, overrides.storageConfig || overrides.storage),
    };

    return res.status(200).json({
      bookId,
      config: overrides,
      effective,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/books/:bookId/preferences
 * Update specific volume overrides without mutating global user preferences.
 * Serialized per user via withUserLock.
 */
export async function updateBookPreferences(req, res, next) {
  try {
    const { bookId } = req.params;
    const userId = req.userId;
    const updates = req.body;

    if (!isValidUuid(bookId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid book ID format.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        error: {
          message: 'No preference overrides provided in request body.',
          code: 'NO_UPDATES_PROVIDED',
        },
      });
    }

    // Verify book ownership
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const inputOverrides = updates.config && typeof updates.config === 'object' ? updates.config : updates;
    validatePreferenceUpdates(inputOverrides);

    return await withUserLock(userId, async () => {
      await verifyReferencedAssets(userId, inputOverrides);

      const existing = await prisma.bookPreference.findUnique({
        where: { bookId_userId: { bookId, userId } },
      });

      const currentConfig = (existing?.config && typeof existing.config === 'object') ? existing.config : {};
      const newConfig = mergeConfigs(currentConfig, inputOverrides);

      const saved = await prisma.bookPreference.upsert({
        where: { bookId_userId: { bookId, userId } },
        update: { config: newConfig },
        create: {
          userId,
          bookId,
          config: newConfig,
        },
      });

      // Compute updated effective preferences
      const globalPref = await prisma.userPreference.findUnique({ where: { userId } });
      const globalSanitized = sanitizeUserPreference(globalPref, userId);

      const effective = {
        reading: mergeConfigs(globalSanitized.readingConfig, newConfig.readingConfig || newConfig.reading),
        typography: mergeConfigs(globalSanitized.typographyConfig, newConfig.typographyConfig || newConfig.typography),
        annotations: mergeConfigs(globalSanitized.annotationsConfig, newConfig.annotationsConfig || newConfig.annotations),
        atmosphere: mergeConfigs(globalSanitized.atmosphereConfig, newConfig.atmosphereConfig || newConfig.atmosphere),
        storage: mergeConfigs(globalSanitized.storageConfig, newConfig.storageConfig || newConfig.storage),
      };

      return res.status(200).json({
        message: 'Book preferences updated successfully.',
        bookId,
        config: saved.config,
        effective,
      });
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: {
          message: err.message,
          code: err.code || 'INVALID_PREFERENCE',
        },
      });
    }
    next(err);
  }
}
