/**
 * Canonical default sanctuary preferences schema and allowed value constants for Aks (अक्स)
 */

export const DEFAULT_USER_PREFERENCES = {
  readingConfig: {
    defaultMode: 'book', // 'book' | 'pdf' | 'focus'
    pageTurnAnimation: true,
    animationSpeed: 'normal', // 'slow' | 'normal' | 'fast'
    layout: 'double', // 'single' | 'double'
    scrollDirection: 'vertical', // 'vertical' | 'horizontal'
    scrollBehavior: 'smooth',
    fullscreenPreference: 'off',
    distractionFree: false,
    pageTurnSound: true,
  },
  typographyConfig: {
    fontFamily: 'serif', // 'serif' | 'sans' | 'mono' | 'lexend'
    fontSize: 18, // 12 - 28
    lineHeight: 1.7, // 1.3 - 2.2
    margins: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
    surfaceTheme: 'navy', // 'navy' | 'cream' | 'slate' | 'contrast'
  },
  annotationsConfig: {
    defaultMarker: 'peacock-feather',
    markerColor: 'gold', // 'gold' | 'teal' | 'emerald' | 'amber' | 'indigo' | 'rose'
    customMarkerUrl: null,
    customMarkerId: null,
    defaultHighlightColor: 'gold',
    showTimestamps: true,
    autoOpenDrawer: false,
    defaultCategory: 'Reflection',
  },
  atmosphereConfig: {
    currentMoodId: 'modern-dark', // 'warm-literary' | 'modern-dark' | 'minimal-clean' | 'colorful-personal'
    backgroundMode: 'classic', // 'classic' | 'custom' | 'pure-white' | 'pure-black'
    backgroundScope: 'all', // 'home' | 'all'
    backgroundIntensity: 'subtle',
    backgroundDimming: 20, // 0 - 80 %
    blurIntensity: 0, // 0 - 20 px
    positioning: 'center', // 'center' | 'top' | 'bottom'
    motionEnabled: true,
    customMediaId: null,
    customMediaMeta: null,
  },
  storageConfig: {
    autoSaveProgress: true,
    autoSaveNotes: true,
    syncInterval: 'instant',
  },
};

export const VALID_MODES = ['book', 'pdf', 'focus'];
export const VALID_ANIMATION_SPEEDS = ['slow', 'normal', 'fast'];
export const VALID_LAYOUTS = ['single', 'double'];
export const VALID_SCROLL_DIRS = ['vertical', 'horizontal'];
export const VALID_SCROLL_BEHAVIORS = ['smooth', 'auto'];
export const VALID_FULLSCREEN_PREFS = ['auto', 'off'];

export const VALID_FONT_FAMILIES = ['serif', 'sans', 'mono', 'lexend'];
export const VALID_MARGINS = ['compact', 'comfortable', 'spacious'];
export const VALID_THEMES = ['navy', 'cream', 'slate', 'contrast'];

export const VALID_BG_MODES = ['classic', 'custom', 'pure-white', 'pure-black'];
export const VALID_BG_SCOPES = ['home', 'all'];
export const VALID_BG_INTENSITIES = ['subtle', 'immersive'];
export const VALID_MOODS = ['warm-literary', 'modern-dark', 'minimal-clean', 'colorful-personal'];
export const VALID_POSITIONING = ['center', 'top', 'bottom'];

export const VALID_MARKERS = ['peacock-feather', 'classic-ribbon', 'geometric-leaf', 'modern-pin'];
export const VALID_ANNOTATION_COLORS = ['gold', 'teal', 'emerald', 'amber', 'indigo', 'rose'];
export const VALID_CATEGORIES = ['Reflection', 'Quote', 'Analysis', 'Vocabulary'];

export const ALLOWED_CATEGORIES = [
  'readingConfig',
  'reading',
  'typographyConfig',
  'typography',
  'annotationsConfig',
  'annotations',
  'atmosphereConfig',
  'atmosphere',
  'storageConfig',
  'storage',
];

export const ALLOWED_KEYS_BY_CATEGORY = {
  reading: [
    'defaultMode',
    'pageTurnAnimation',
    'animationSpeed',
    'layout',
    'scrollDirection',
    'scrollBehavior',
    'fullscreenPreference',
    'distractionFree',
    'pageTurnSound',
  ],
  typography: [
    'fontFamily',
    'fontSize',
    'lineHeight',
    'margins',
    'surfaceTheme',
  ],
  annotations: [
    'defaultMarker',
    'markerColor',
    'customMarkerUrl',
    'customMarkerId',
    'defaultHighlightColor',
    'showTimestamps',
    'autoOpenDrawer',
    'defaultCategory',
  ],
  atmosphere: [
    'currentMoodId',
    'backgroundMode',
    'backgroundScope',
    'backgroundIntensity',
    'backgroundDimming',
    'blurIntensity',
    'positioning',
    'motionEnabled',
    'customMediaId',
    'customMediaMeta',
  ],
  storage: [
    'autoSaveProgress',
    'autoSaveNotes',
    'syncInterval',
  ],
};
