/**
 * SettingsPage.jsx
 * Aks (अक्स) — Sanctuary Settings (Page 7)
 *
 * Comprehensive settings dashboard with:
 * - Versioned automatic persistence
 * - Global sanctuary defaults and per-book overrides
 * - 5 categories: Reading Experience, Typography & Comfort, Bookmarks & Annotations, Atmosphere & Backgrounds, Data & Storage
 * - Live typography preview, mood studio integration, custom marker & media uploads
 * - Full export tools (Notes MD/JSON, Bookmarks JSON, Library JSON)
 * - Safe reset confirmation modal
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Home,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BookOpen,
  Type,
  Bookmark,
  Palette,
  HardDrive,
  RotateCcw,
  Upload,
  Download,
  FileText,
  Trash2,
  Info,
  Eye,
  Check,
  Feather,
  Cloud,
  Layers,
  LogOut,
  Image as ImageIcon,
  Video,
  X,
  Sun,
  Moon,
} from 'lucide-react';

import {
  loadPreferences,
  savePreferences,
  setBookOverride,
  removeBookOverride,
  resetGlobalCategory,
  resetAllSettings,
  exportNotesAsMarkdown,
  exportNotesAsJson,
  exportBookmarksAsJson,
  exportLibraryMetadata,
  subscribePreferences,
} from '../services/preferencesService';
import { getAllNotes } from '../services/db';
import {
  saveCustomBackgroundMedia,
  getCustomBackgroundMedia,
  deleteCustomBackgroundMedia,
} from '../services/mediaStorage';
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  ACCENT_PRESETS,
  isValidHex,
  normalizeHex,
  applyTheme,
} from '../services/themeService';
import '../styles/settings.css';

const CATEGORIES = [
  { id: 'reading', label: 'Reading Experience', icon: BookOpen },
  { id: 'typography', label: 'Typography & Comfort', icon: Type },
  { id: 'annotations', label: 'Bookmarks & Annotations', icon: Bookmark },
  { id: 'background', label: 'Background & Appearance', icon: ImageIcon },
  { id: 'theme', label: 'Theme Colors', icon: Palette },
  { id: 'storage', label: 'Data & Storage', icon: HardDrive },
];

const MARKER_COLORS = [
  { id: 'gold', label: 'Champagne Gold', bg: '#E7C18A', text: '#1a1207' },
  { id: 'teal', label: 'Peacock Teal', bg: '#2DD4BF', text: '#042f2e' },
  { id: 'emerald', label: 'Deep Emerald', bg: '#4ADE80', text: '#052e16' },
  { id: 'amber', label: 'Warm Amber', bg: '#FBBF24', text: '#291a02' },
  { id: 'indigo', label: 'Royal Indigo', bg: '#818CF8', text: '#1e1b4b' },
];

const HIGHLIGHT_COLORS = [
  { id: 'gold', label: 'Champagne Gold', bg: '#E7C18A' },
  { id: 'teal', label: 'Peacock Teal', bg: '#2DD4BF' },
  { id: 'emerald', label: 'Emerald Mint', bg: '#4ADE80' },
  { id: 'amber', label: 'Honey Amber', bg: '#FBBF24' },
  { id: 'indigo', label: 'Royal Indigo', bg: '#818CF8' },
  { id: 'rose', label: 'Dusty Rose', bg: '#FB7185' },
];

export default function SettingsPage({
  books = [],
  onNavigateTo,
  onSelectMood,
  onToggleIntensity,
  customMedia,
  onUploadMedia,
  onClearCustomMedia,
  currentUser = null,
  onLogout = null,
  onOpenMigration = null,
  initialCategory = 'reading',
  backgroundMode: propBgMode,
  onSelectBackgroundMode,
  backgroundScope: propBgScope,
  backgroundDimming: propBgDimming,
  blurIntensity: propBgBlur,
  positioning: propBgPosition,
  motionEnabled: propBgMotion,
}) {
  const [activeCategory, setActiveCategory] = useState(initialCategory || 'reading');
  const [selectedBookId, setSelectedBookId] = useState('global'); // 'global' or book.id
  const [prefs, setPrefs] = useState(() => loadPreferences());
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'error'
  const [statusMessage, setStatusMessage] = useState('All changes saved');
  const [confirmModal, setConfirmModal] = useState(null); // 'clear-all' | 'reset-book' | null
  const [allNotes, setAllNotes] = useState([]);
  const [uploadError, setUploadError] = useState(null);

  // Background & Appearance controls
  const fileInputRef = useRef(null);
  const atmoPrefs = prefs?.global?.atmosphere || {};
  const [bgMode, setBgMode] = useState(() => propBgMode || atmoPrefs.backgroundMode || 'classic');
  const [prevPropBgMode, setPrevPropBgMode] = useState(propBgMode);
  if (propBgMode && propBgMode !== prevPropBgMode) {
    setPrevPropBgMode(propBgMode);
    setBgMode(propBgMode);
  }

  const [bgScope, setBgScope] = useState(() => propBgScope || atmoPrefs.backgroundScope || 'all');
  const [bgDimming, setBgDimming] = useState(() => propBgDimming ?? atmoPrefs.backgroundDimming ?? 20);
  const [bgBlur, setBgBlur] = useState(() => propBgBlur ?? atmoPrefs.blurIntensity ?? 0);
  const [bgPosition, setBgPosition] = useState(() => propBgPosition || atmoPrefs.positioning || 'center');
  const [bgMotion, setBgMotion] = useState(() => propBgMotion ?? atmoPrefs.motionEnabled ?? true);
  const [stagedMedia, setStagedMedia] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [bgError, setBgError] = useState(null);
  const [bgSuccess, setBgSuccess] = useState(null);

  // Theme Colors controls
  const currentTheme = prefs?.global?.theme || DEFAULT_THEME;
  const [themePrimary, setThemePrimary] = useState(() => currentTheme.primaryColor || DEFAULT_THEME.primaryColor);
  const [themeAccent, setThemeAccent] = useState(() => currentTheme.accentColor || DEFAULT_THEME.accentColor);
  const [_isCustomTheme, setIsCustomTheme] = useState(() => currentTheme.isCustom ?? false);
  const [primaryHexInput, setPrimaryHexInput] = useState(() => currentTheme.primaryColor || DEFAULT_THEME.primaryColor);
  const [accentHexInput, setAccentHexInput] = useState(() => currentTheme.accentColor || DEFAULT_THEME.accentColor);
  const [hexError, setHexError] = useState(null);
  const [themeSuccess, setThemeSuccess] = useState(null);

  // Sync initialCategory if changed externally
  const [prevInitialCategory, setPrevInitialCategory] = useState(initialCategory);
  if (initialCategory && initialCategory !== prevInitialCategory) {
    setPrevInitialCategory(initialCategory);
    setActiveCategory(initialCategory);
  }

  // Subscribe to external preference updates
  useEffect(() => {
    const unsubscribe = subscribePreferences((updated) => {
      setPrefs(updated);
      if (updated?.global?.atmosphere) {
        const at = updated.global.atmosphere;
        if (at.backgroundMode) setBgMode(at.backgroundMode);
        if (at.backgroundScope) setBgScope(at.backgroundScope);
        if (typeof at.backgroundDimming === 'number') setBgDimming(at.backgroundDimming);
        if (typeof at.blurIntensity === 'number') setBgBlur(at.blurIntensity);
        if (at.positioning) setBgPosition(at.positioning);
        if (typeof at.motionEnabled === 'boolean') setBgMotion(at.motionEnabled);
      }
      if (updated?.global?.theme) {
        const th = updated.global.theme;
        setThemePrimary(th.primaryColor || DEFAULT_THEME.primaryColor);
        setThemeAccent(th.accentColor || DEFAULT_THEME.accentColor);
        setIsCustomTheme(th.isCustom ?? false);
        setPrimaryHexInput(th.primaryColor || DEFAULT_THEME.primaryColor);
        setAccentHexInput(th.accentColor || DEFAULT_THEME.accentColor);
      }
    });
    return unsubscribe;
  }, []);

  // Fetch all notes for export actions
  useEffect(() => {
    getAllNotes()
      .then((notes) => setAllNotes(notes || []))
      .catch((err) => console.warn('Could not load notes for settings export:', err));
  }, []);

  // Current target book object
  const targetBook = useMemo(() => {
    if (selectedBookId === 'global') return null;
    return books.find((b) => b.id === selectedBookId) || null;
  }, [books, selectedBookId]);

  // Current active settings values (resolving overrides if in book scope)
  const currentValues = useMemo(() => {
    if (selectedBookId === 'global' || !targetBook) {
      return prefs.global;
    }
    const overrides = prefs.bookOverrides[selectedBookId] || {};
    return {
      reading: { ...prefs.global.reading, ...(overrides.reading || {}) },
      typography: { ...prefs.global.typography, ...(overrides.typography || {}) },
      annotations: { ...prefs.global.annotations, ...(overrides.annotations || {}) },
      atmosphere: { ...prefs.global.atmosphere, ...(overrides.atmosphere || {}) },
      storage: { ...prefs.global.storage, ...(overrides.storage || {}) },
    };
  }, [prefs, selectedBookId, targetBook]);

  // Check if current book has overrides for active category
  const hasBookOverride = useMemo(() => {
    if (selectedBookId === 'global') return false;
    const bOverrides = prefs.bookOverrides[selectedBookId];
    if (!bOverrides) return false;
    return !!bOverrides[activeCategory] && Object.keys(bOverrides[activeCategory]).length > 0;
  }, [prefs.bookOverrides, selectedBookId, activeCategory]);

  // ── Auto-Save Preference Updates ──────────────────────────────────────────
  const updatePreference = useCallback(
    (category, key, value) => {
      setSaveStatus('saving');
      setStatusMessage('Saving...');

      try {
        if (selectedBookId === 'global') {
          const current = loadPreferences();
          current.global[category] = {
            ...(current.global[category] || {}),
            [key]: value,
          };
          const saved = savePreferences(current);
          setPrefs(saved);
        } else {
          const saved = setBookOverride(selectedBookId, category, { [key]: value });
          setPrefs(saved);
        }

        // Live Atmosphere sync with App.jsx
        if (category === 'atmosphere') {
          if (key === 'currentMoodId' && onSelectMood) onSelectMood(value);
          if (key === 'backgroundIntensity' && onToggleIntensity) onToggleIntensity(value);
          if (key === 'backgroundMode' && onSelectBackgroundMode) onSelectBackgroundMode(value);
        }

        setTimeout(() => {
          setSaveStatus('saved');
          setStatusMessage('Saved');
        }, 300);
      } catch (err) {
        console.error('[Settings] Auto-save failed:', err);
        setSaveStatus('error');
        setStatusMessage(err.message || 'Storage error');
      }
    },
    [selectedBookId, onSelectMood, onToggleIntensity, onSelectBackgroundMode]
  );

  // Reset category handler
  const handleResetCategory = () => {
    setSaveStatus('saving');
    setStatusMessage('Restoring defaults...');
    try {
      if (selectedBookId === 'global') {
        const saved = resetGlobalCategory(activeCategory);
        setPrefs(saved);
      } else {
        const saved = removeBookOverride(selectedBookId, activeCategory);
        setPrefs(saved);
      }
      setTimeout(() => {
        setSaveStatus('saved');
        setStatusMessage('Defaults restored');
      }, 300);
    } catch (err) {
      console.warn('[Settings] Reset category failed:', err);
      setSaveStatus('error');
      setStatusMessage('Failed to reset');
    }
  };

  // Reset entire book overrides
  const handleResetEntireBook = () => {
    if (!selectedBookId || selectedBookId === 'global') return;
    setSaveStatus('saving');
    try {
      const saved = removeBookOverride(selectedBookId);
      setPrefs(saved);
      setConfirmModal(null);
      setTimeout(() => {
        setSaveStatus('saved');
        setStatusMessage(`Overrides removed for ${targetBook?.title || 'volume'}`);
      }, 300);
    } catch (err) {
      console.warn('[Settings] Reset overrides failed:', err);
      setSaveStatus('error');
      setStatusMessage('Failed to reset overrides');
    }
  };

  // Handle Clear Local Application Data
  const handleConfirmClearAll = () => {
    try {
      const saved = resetAllSettings();
      setPrefs(saved);
      if (onClearCustomMedia) onClearCustomMedia();
      setConfirmModal(null);
      setSaveStatus('saved');
      setStatusMessage('All settings reset to sanctuary defaults');
    } catch (err) {
      console.warn('[Settings] Clear data failed:', err);
      setSaveStatus('error');
      setStatusMessage('Failed to clear data');
    }
  };

  // ── Log Out Handler ───────────────────────────────────────────────────────
  const handleConfirmLogout = () => {
    setConfirmModal(null);
    try {
      localStorage.removeItem('aks_auth_user');
    } catch (_) {}
    if (onLogout) {
      onLogout();
    } else if (onNavigateTo) {
      onNavigateTo('login');
    }
  };

  // ── Custom Marker Upload Handler ──────────────────────────────────────────
  const handleCustomMarkerUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      setUploadError('Please select a PNG, JPG, WebP, or SVG image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Marker image must be less than 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      updatePreference('annotations', 'customMarkerUrl', dataUrl);
      updatePreference('annotations', 'defaultMarker', 'custom');
    };
    reader.onerror = () => {
      setUploadError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  // ── Format file size helper ──────────────────────────────────────────────
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // ── Background & Appearance Handlers ─────────────────────────────────────
  const handleSelectClassic = () => {
    setBgMode('classic');
    setStagedMedia(null);
    updatePreference('atmosphere', 'backgroundMode', 'classic');
    const currentTheme = prefs?.global?.theme || DEFAULT_THEME;
    applyTheme(currentTheme, 'classic');
    if (onSelectBackgroundMode) {
      onSelectBackgroundMode('classic');
    }
    setBgSuccess('Restored Option A — Classic Aks appearance.');
    setTimeout(() => setBgSuccess(null), 3000);
  };

  const handleSelectUploadMode = async () => {
    let mediaToUse = customMedia || stagedMedia;
    if (!mediaToUse) {
      try {
        const stored = await getCustomBackgroundMedia();
        if (stored && stored.blob) {
          const url = URL.createObjectURL(stored.blob);
          mediaToUse = {
            url,
            type: stored.type,
            name: stored.name,
            size: stored.size,
            mimeType: stored.mimeType,
          };
        }
      } catch (err) {
        console.warn('[Settings] Could not retrieve stored custom background:', err);
      }
    }

    if (mediaToUse) {
      setBgMode('custom');
      updatePreference('atmosphere', 'backgroundMode', 'custom');
      const currentTheme = prefs?.global?.theme || DEFAULT_THEME;
      applyTheme(currentTheme, 'custom');
      if (onSelectBackgroundMode) {
        onSelectBackgroundMode('custom');
      }
      if (onUploadMedia) {
        onUploadMedia(mediaToUse);
      }
      setBgSuccess('Applied Option B — Custom Sanctuary background.');
      setTimeout(() => setBgSuccess(null), 3000);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleSelectPureWhite = () => {
    setBgMode('pure-white');
    setStagedMedia(null);
    updatePreference('atmosphere', 'backgroundMode', 'pure-white');
    const currentTheme = prefs?.global?.theme || DEFAULT_THEME;
    applyTheme(currentTheme, 'pure-white');
    if (onSelectBackgroundMode) {
      onSelectBackgroundMode('pure-white');
    }
    setBgSuccess('Applied Option C — Pure White appearance.');
    setTimeout(() => setBgSuccess(null), 3000);
  };

  const handleSelectPureBlack = () => {
    setBgMode('pure-black');
    setStagedMedia(null);
    updatePreference('atmosphere', 'backgroundMode', 'pure-black');
    const currentTheme = prefs?.global?.theme || DEFAULT_THEME;
    applyTheme(currentTheme, 'pure-black');
    if (onSelectBackgroundMode) {
      onSelectBackgroundMode('pure-black');
    }
    setBgSuccess('Applied Option D — Pure Black appearance.');
    setTimeout(() => setBgSuccess(null), 3000);
  };

  const validateMediaFile = (file) => {
    if (!file) return { valid: false, error: 'No file selected.' };

    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    const isImage =
      type === 'image/jpeg' ||
      type === 'image/png' ||
      type === 'image/webp' ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.png') ||
      name.endsWith('.webp');

    const isVideo =
      type === 'video/mp4' ||
      type === 'video/webm' ||
      name.endsWith('.mp4') ||
      name.endsWith('.webm');

    if (!isImage && !isVideo) {
      return {
        valid: false,
        error: 'Unsupported file format. Please upload JPG, PNG, WebP, MP4, or WebM.',
      };
    }

    if (isImage && file.size > 15 * 1024 * 1024) {
      return {
        valid: false,
        error: 'Image file size exceeds the 15MB limit.',
      };
    }

    if (isVideo && file.size > 50 * 1024 * 1024) {
      return {
        valid: false,
        error: 'Video file size exceeds the 50MB limit.',
      };
    }

    return { valid: true, type: isVideo ? 'video' : 'image' };
  };

  const handleFileSelect = (file) => {
    setBgError(null);
    setBgSuccess(null);
    const result = validateMediaFile(file);
    if (!result.valid) {
      setBgError(result.error);
      return;
    }

    // Revoke previous staged preview if any
    if (stagedMedia?.url && stagedMedia.url.startsWith('blob:')) {
      URL.revokeObjectURL(stagedMedia.url);
    }

    const tempUrl = URL.createObjectURL(file);
    setStagedMedia({
      file,
      url: tempUrl,
      type: result.type,
      name: file.name,
      size: file.size,
    });
    setBgMode('custom');
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    if (e.target) e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDimmingChange = (val) => {
    setBgDimming(val);
    updatePreference('atmosphere', 'backgroundDimming', val);
  };

  const handleBlurChange = (val) => {
    setBgBlur(val);
    updatePreference('atmosphere', 'blurIntensity', val);
  };

  const handlePositionChange = (pos) => {
    setBgPosition(pos);
    updatePreference('atmosphere', 'positioning', pos);
  };

  const handleScopeChange = (scope) => {
    setBgScope(scope);
    updatePreference('atmosphere', 'backgroundScope', scope);
  };

  const handleMotionToggle = (checked) => {
    setBgMotion(checked);
    updatePreference('atmosphere', 'motionEnabled', checked);
  };

  const handleApplyBackground = async () => {
    setBgError(null);
    setBgSuccess(null);
    try {
      if (stagedMedia) {
        await saveCustomBackgroundMedia(
          stagedMedia.file,
          stagedMedia.type,
          stagedMedia.name
        );

        updatePreference('atmosphere', 'backgroundMode', 'custom');
        updatePreference('atmosphere', 'backgroundScope', bgScope);
        updatePreference('atmosphere', 'backgroundDimming', bgDimming);
        updatePreference('atmosphere', 'blurIntensity', bgBlur);
        updatePreference('atmosphere', 'positioning', bgPosition);
        updatePreference('atmosphere', 'motionEnabled', bgMotion);
        updatePreference('atmosphere', 'customMediaMeta', {
          type: stagedMedia.type,
          name: stagedMedia.name,
          size: stagedMedia.size,
          mimeType: stagedMedia.file.type || (stagedMedia.type === 'video' ? 'video/mp4' : 'image/jpeg'),
          updatedAt: Date.now(),
        });

        if (onUploadMedia) {
          onUploadMedia({
            url: stagedMedia.url,
            type: stagedMedia.type,
            name: stagedMedia.name,
            size: stagedMedia.size,
            mimeType: stagedMedia.file.type,
          });
        }

        setBgMode('custom');
        setStagedMedia(null);
        setBgSuccess('Custom background successfully applied across sanctuary!');
      } else if (customMedia) {
        updatePreference('atmosphere', 'backgroundMode', 'custom');
        updatePreference('atmosphere', 'backgroundScope', bgScope);
        updatePreference('atmosphere', 'backgroundDimming', bgDimming);
        updatePreference('atmosphere', 'blurIntensity', bgBlur);
        updatePreference('atmosphere', 'positioning', bgPosition);
        updatePreference('atmosphere', 'motionEnabled', bgMotion);
        setBgMode('custom');
        if (onUploadMedia) {
          onUploadMedia(customMedia);
        }
        setBgSuccess('Background display settings updated.');
      } else {
        updatePreference('atmosphere', 'backgroundMode', bgMode);
        updatePreference('atmosphere', 'backgroundScope', bgScope);
        updatePreference('atmosphere', 'backgroundDimming', bgDimming);
        updatePreference('atmosphere', 'blurIntensity', bgBlur);
        updatePreference('atmosphere', 'positioning', bgPosition);
        updatePreference('atmosphere', 'motionEnabled', bgMotion);
        setBgSuccess('Background display settings updated.');
      }
      setTimeout(() => setBgSuccess(null), 3500);
    } catch (err) {
      console.error('[Settings] Background storage failed:', err);
      setBgError('Storage failed: ' + (err.message || 'Could not save file to IndexedDB.'));
    }
  };

  const handleCancelBackground = () => {
    if (stagedMedia?.url && stagedMedia.url.startsWith('blob:') && stagedMedia.url !== customMedia?.url) {
      URL.revokeObjectURL(stagedMedia.url);
    }
    setStagedMedia(null);
    setBgError(null);
    const savedAtmo = prefs?.global?.atmosphere || {};
    setBgMode(savedAtmo.backgroundMode || 'classic');
    setBgScope(savedAtmo.backgroundScope || 'home');
    setBgDimming(savedAtmo.backgroundDimming ?? 20);
    setBgBlur(savedAtmo.blurIntensity ?? 0);
    setBgPosition(savedAtmo.positioning || 'center');
    setBgMotion(savedAtmo.motionEnabled ?? true);
  };

  const handleRemoveBackground = async () => {
    try {
      await deleteCustomBackgroundMedia();
      if (stagedMedia?.url && stagedMedia.url.startsWith('blob:')) {
        URL.revokeObjectURL(stagedMedia.url);
      }
      setStagedMedia(null);
      setBgMode('classic');
      updatePreference('atmosphere', 'backgroundMode', 'classic');
      updatePreference('atmosphere', 'customMediaMeta', null);
      if (onClearCustomMedia) onClearCustomMedia();
      setBgSuccess('Custom background removed. Restored Classic Aks appearance.');
      setTimeout(() => setBgSuccess(null), 3500);
    } catch (err) {
      console.warn('[Settings] Failed to delete custom background:', err);
      setBgError('Could not delete background file.');
    }
  };

  // ── Theme Colors Handlers ────────────────────────────────────────────────
  const persistAndApplyTheme = (themeObj) => {
    applyTheme(themeObj, bgMode);
    try {
      const current = loadPreferences();
      current.global.theme = themeObj;
      const saved = savePreferences(current);
      setPrefs(saved);
    } catch (err) {
      console.warn('[Settings] Theme auto-save warning:', err);
    }
  };

  const handlePresetThemeClick = (preset) => {
    setThemePrimary(preset.hex);
    setPrimaryHexInput(preset.hex);
    setIsCustomTheme(true);
    setHexError(null);
    const themeObj = {
      primaryColor: preset.hex,
      accentColor: themeAccent,
      isCustom: true,
    };
    persistAndApplyTheme(themeObj);
  };

  const handleNativeColorChange = (hex) => {
    const norm = normalizeHex(hex);
    setThemePrimary(norm);
    setPrimaryHexInput(norm);
    setIsCustomTheme(true);
    setHexError(null);
    const themeObj = {
      primaryColor: norm,
      accentColor: themeAccent,
      isCustom: true,
    };
    persistAndApplyTheme(themeObj);
  };

  const handlePrimaryHexChange = (raw) => {
    let clean = raw.trim();
    if (!clean.startsWith('#')) clean = `#${clean}`;
    setPrimaryHexInput(clean);

    if (isValidHex(clean)) {
      setHexError(null);
      const norm = normalizeHex(clean);
      setThemePrimary(norm);
      setIsCustomTheme(true);
      const themeObj = {
        primaryColor: norm,
        accentColor: themeAccent,
        isCustom: true,
      };
      persistAndApplyTheme(themeObj);
    } else {
      setHexError('Please enter a valid hex color code (e.g. #080E19)');
    }
  };

  const handleAccentPresetClick = (acc) => {
    setThemeAccent(acc.hex);
    setAccentHexInput(acc.hex);
    setIsCustomTheme(true);
    const themeObj = {
      primaryColor: themePrimary,
      accentColor: acc.hex,
      isCustom: true,
    };
    persistAndApplyTheme(themeObj);
  };

  const handleNativeAccentChange = (hex) => {
    const norm = normalizeHex(hex);
    setThemeAccent(norm);
    setAccentHexInput(norm);
    setIsCustomTheme(true);
    const themeObj = {
      primaryColor: themePrimary,
      accentColor: norm,
      isCustom: true,
    };
    persistAndApplyTheme(themeObj);
  };

  const handleAccentHexChange = (raw) => {
    let clean = raw.trim();
    if (!clean.startsWith('#')) clean = `#${clean}`;
    setAccentHexInput(clean);

    if (isValidHex(clean)) {
      const norm = normalizeHex(clean);
      setThemeAccent(norm);
      setIsCustomTheme(true);
      const themeObj = {
        primaryColor: themePrimary,
        accentColor: norm,
        isCustom: true,
      };
      persistAndApplyTheme(themeObj);
    }
  };

  const handleApplyTheme = () => {
    const normPrimary = normalizeHex(themePrimary);
    const normAccent = normalizeHex(themeAccent);
    const themeObj = {
      primaryColor: normPrimary,
      accentColor: normAccent,
      isCustom: true,
    };

    persistAndApplyTheme(themeObj);
    setThemeSuccess('Custom theme successfully applied across sanctuary!');
    setTimeout(() => setThemeSuccess(null), 3000);
  };

  const handleCancelTheme = () => {
    const savedTheme = prefs?.global?.theme || DEFAULT_THEME;
    setThemePrimary(savedTheme.primaryColor || DEFAULT_THEME.primaryColor);
    setThemeAccent(savedTheme.accentColor || DEFAULT_THEME.accentColor);
    setIsCustomTheme(savedTheme.isCustom ?? false);
    setPrimaryHexInput(savedTheme.primaryColor || DEFAULT_THEME.primaryColor);
    setAccentHexInput(savedTheme.accentColor || DEFAULT_THEME.accentColor);
    setHexError(null);
    persistAndApplyTheme(savedTheme);
  };

  const handleResetThemeToDefault = () => {
    setThemePrimary(DEFAULT_THEME.primaryColor);
    setThemeAccent(DEFAULT_THEME.accentColor);
    setIsCustomTheme(false);
    setPrimaryHexInput(DEFAULT_THEME.primaryColor);
    setAccentHexInput(DEFAULT_THEME.accentColor);
    setHexError(null);

    const themeObj = {
      primaryColor: DEFAULT_THEME.primaryColor,
      accentColor: DEFAULT_THEME.accentColor,
      isCustom: false,
    };
    persistAndApplyTheme(themeObj);
    setThemeSuccess('Theme restored to classic Aks Midnight Blue.');
    setTimeout(() => setThemeSuccess(null), 3000);
  };

  return (
    <div className="settings-page-container">
      {/* ── 1. Breadcrumbs ─────────────────────────────────────────────────── */}
      <nav className="settings-breadcrumbs" aria-label="Breadcrumb">
        <button
          className="settings-breadcrumb-link"
          onClick={() => onNavigateTo && onNavigateTo('home')}
        >
          <Home size={13} />
          <span>Home</span>
        </button>
        <ChevronRight size={13} className="settings-breadcrumb-sep" />
        <span className="settings-breadcrumb-current">Settings</span>
      </nav>

      {/* ── 2. Editorial Header with Auto-Save Status ───────────────────────── */}
      <header className="settings-header-section">
        <div className="settings-header-text">
          <div className="settings-badge-row">
            <span className="settings-badge">
              <Sparkles size={13} className="text-gold" />
              Sanctuary Preferences
            </span>

            {/* Auto-save status indicator */}
            <span
              className={`settings-status-pill status-${saveStatus}`}
              role="status"
              aria-live="polite"
            >
              {saveStatus === 'saving' && <Loader2 size={12} className="settings-spin" />}
              {saveStatus === 'saved' && <CheckCircle2 size={12} className="text-teal" />}
              {saveStatus === 'error' && <AlertCircle size={12} className="text-danger" />}
              <span>{statusMessage}</span>
            </span>
          </div>

          <h1 className="settings-title">Sanctuary Settings</h1>
          <p className="settings-subtitle">Make your reading space your own.</p>
        </div>
      </header>

      {/* ── 3. Target Scope Switcher: Global Defaults vs Per-Book Overrides ─── */}
      <section className="settings-scope-card" aria-label="Settings scope selector">
        <div className="settings-scope-info">
          <div className="settings-scope-icon-wrap">
            <Layers size={20} />
          </div>
          <div>
            <h2 className="settings-scope-title">
              {selectedBookId === 'global'
                ? 'Global Sanctuary Defaults'
                : `Volume Overrides: ${targetBook?.title || 'Selected Book'}`}
            </h2>
            <p className="settings-scope-desc">
              {selectedBookId === 'global'
                ? 'Preferences here apply to all books in your library unless individually overridden.'
                : 'Custom rules for this specific book will override your global sanctuary defaults.'}
            </p>
          </div>
        </div>

        <div className="settings-scope-actions">
          <select
            className="settings-scope-select"
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
            aria-label="Select configuration scope"
          >
            <option value="global">All Books (Global Defaults)</option>
            <optgroup label="Configure Per-Book Overrides">
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} {prefs.bookOverrides[b.id] ? '★ (Custom Overrides)' : ''}
                </option>
              ))}
            </optgroup>
          </select>

          {selectedBookId !== 'global' && prefs.bookOverrides[selectedBookId] && (
            <button
              className="settings-reset-override-btn"
              onClick={() => setConfirmModal('reset-book')}
              title="Reset all overrides for this book"
            >
              <RotateCcw size={13} />
              <span>Reset to Defaults</span>
            </button>
          )}
        </div>
      </section>

      {/* ── 4. Mobile Category Selector Tabs ───────────────────────────────── */}
      <nav className="settings-mobile-tabs" aria-label="Settings Categories (Mobile)">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              className={`settings-mobile-tab-btn ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <Icon size={14} />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── 5. Main Dashboard Two-Column Grid ───────────────────────────────── */}
      <div className="settings-dashboard-grid">
        {/* Left Side: Category Navigation Card */}
        <aside className="settings-nav-card" aria-label="Settings categories">
          <div className="settings-nav-header">Sanctuary Domains</div>
          <div className="settings-nav-list" role="tablist">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              const categoryOverridden =
                selectedBookId !== 'global' &&
                prefs.bookOverrides[selectedBookId]?.[cat.id];

              return (
                <button
                  key={cat.id}
                  className={`settings-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                  role="tab"
                  aria-selected={isActive}
                >
                  <div className="settings-nav-item-content">
                    <Icon size={17} className="settings-nav-icon" />
                    <span>{cat.label}</span>
                  </div>
                  {categoryOverridden && (
                    <span className="settings-nav-badge" title="Has custom book overrides">
                      Custom
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="settings-nav-logout-section">
            <button
              type="button"
              className="settings-nav-logout-btn"
              onClick={() => setConfirmModal('logout')}
              aria-label="Log Out of Aks Sanctuary"
            >
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          </div>
        </aside>

        {/* Right Side: Active Category Panel */}
        <main className="settings-content-panel">
          {/* ══════════════════════════════════════════════════════════════════
              CATEGORY 1: READING EXPERIENCE
              ══════════════════════════════════════════════════════════════════ */}
          {activeCategory === 'reading' && (
            <div className="settings-section-card">
              <div className="settings-section-header">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="settings-section-title">
                      <BookOpen size={20} className="text-gold" />
                      <span>Reading Experience</span>
                      {hasBookOverride && (
                        <span className="settings-override-indicator">Overridden for Volume</span>
                      )}
                    </h2>
                    <p className="settings-section-desc">
                      Customize reader view modes, 3D paper animation physics, spread layouts, and immersion.
                    </p>
                  </div>
                  <button
                    className="settings-reset-override-btn"
                    onClick={handleResetCategory}
                    title="Restore defaults for this category"
                  >
                    <RotateCcw size={12} />
                    <span>Restore Defaults</span>
                  </button>
                </div>
              </div>

              {/* Informative PDF reassurance banner */}
              <div className="settings-info-badge">
                <Info size={16} />
                <span>
                  <strong>Technical PDF Integrity:</strong> Complex PDF charts, formulas, and documents
                  remain completely readable in PDF mode without forced distortion, even when realistic
                  page-turn animation is disabled.
                </span>
              </div>

              <div className="settings-control-group">
                {/* Default Reader Mode */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Default Reader Mode</h3>
                    <p className="settings-control-help">
                      Choose how newly opened books display initially in the Reading Room.
                    </p>
                  </div>
                  <div className="settings-segmented-group" role="radiogroup">
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.defaultMode === 'book' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'defaultMode', 'book')}
                    >
                      <BookOpen size={14} />
                      <span>Book Mode</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.defaultMode === 'pdf' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'defaultMode', 'pdf')}
                    >
                      <FileText size={14} />
                      <span>PDF Canvas</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.defaultMode === 'focus' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'defaultMode', 'focus')}
                    >
                      <Eye size={14} />
                      <span>Focus Mode</span>
                    </button>
                  </div>
                </div>

                {/* Page-Turn Animation Toggle */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Realistic 3D Page-Turn Animation</h3>
                    <p className="settings-control-help">
                      Enables natural physical book page flipping with central spine shadow and curvature.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.reading.pageTurnAnimation}
                      onChange={(e) =>
                        updatePreference('reading', 'pageTurnAnimation', e.target.checked)
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                {/* Page-Turn Animation Speed */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Page Turn Speed</h3>
                    <p className="settings-control-help">
                      Governs the duration of the paper leaf turn animation in Book Mode.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.animationSpeed === 'slow' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'animationSpeed', 'slow')}
                    >
                      <span>Slow (800ms)</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.animationSpeed === 'normal' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'animationSpeed', 'normal')}
                    >
                      <span>Balanced (500ms)</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.animationSpeed === 'fast' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'animationSpeed', 'fast')}
                    >
                      <span>Brisk (250ms)</span>
                    </button>
                  </div>
                </div>

                {/* Page Turning Sound */}
                <div className="settings-control-row" id="setting-page-turn-sound">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Page Turning Sound</h3>
                    <p className="settings-control-help">
                      Play a subtle, realistic paper-rustling sound when changing pages in Book Mode.
                    </p>
                  </div>
                  <div className="settings-segmented-group" role="group" aria-label="Page Turning Sound">
                    <button
                      type="button"
                      className={`settings-segmented-btn ${currentValues.reading.pageTurnSound !== false ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'pageTurnSound', true)}
                      aria-pressed={currentValues.reading.pageTurnSound !== false}
                    >
                      <span>Enabled</span>
                    </button>
                    <button
                      type="button"
                      className={`settings-segmented-btn ${currentValues.reading.pageTurnSound === false ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'pageTurnSound', false)}
                      aria-pressed={currentValues.reading.pageTurnSound === false}
                    >
                      <span>Disabled</span>
                    </button>
                  </div>
                </div>

                {/* Single vs Double Page Layout */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Book Spread Layout</h3>
                    <p className="settings-control-help">
                      Desktop reading layout preference. Mobile always adapts to single-page comfort.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.layout === 'double' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'layout', 'double')}
                    >
                      <Layers size={14} />
                      <span>Two-Page Spread</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.reading.layout === 'single' ? 'active' : ''}`}
                      onClick={() => updatePreference('reading', 'layout', 'single')}
                    >
                      <BookOpen size={14} />
                      <span>Single Page</span>
                    </button>
                  </div>
                </div>

                {/* Scroll Direction in Continuous PDF Mode */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Continuous PDF Scroll Direction</h3>
                    <p className="settings-control-help">
                      Direction of document flow when using continuous PDF canvas scrolling.
                    </p>
                  </div>
                  <select
                    className="settings-select-input"
                    value={currentValues.reading.scrollDirection}
                    onChange={(e) => updatePreference('reading', 'scrollDirection', e.target.value)}
                  >
                    <option value="vertical">Vertical Continuous Flow</option>
                    <option value="horizontal">Horizontal Side-by-Side</option>
                  </select>
                </div>

                {/* Fullscreen Preference */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Fullscreen Sanctuary Preference</h3>
                    <p className="settings-control-help">
                      Automatically prompt or enter immersive fullscreen when opening a volume.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.reading.fullscreenPreference === 'auto'}
                      onChange={(e) =>
                        updatePreference(
                          'reading',
                          'fullscreenPreference',
                          e.target.checked ? 'auto' : 'off'
                        )
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                {/* Distraction-Free Reading Mode */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Distraction-Free Immersion</h3>
                    <p className="settings-control-help">
                      Subtly dim non-essential toolbar elements during active reading.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.reading.distractionFree}
                      onChange={(e) =>
                        updatePreference('reading', 'distractionFree', e.target.checked)
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CATEGORY 2: TYPOGRAPHY & COMFORT
              ══════════════════════════════════════════════════════════════════ */}
          {activeCategory === 'typography' && (
            <div className="settings-section-card">
              <div className="settings-section-header">
                <h2 className="settings-section-title">
                  <Type size={20} className="text-gold" />
                  <span>Typography & Comfort</span>
                  {hasBookOverride && (
                    <span className="settings-override-indicator">Overridden for Volume</span>
                  )}
                </h2>
                <p className="settings-section-desc">
                  Tune font faces, sizing, line height, margins, and contrast surfaces for maximum reading ease.
                </p>
              </div>

              {/* Informative Disclaimer */}
              <div className="settings-info-badge">
                <Info size={16} />
                <span>
                  <strong>Typography Reflow Scope:</strong> Fixed-layout PDF pages maintain original
                  typesetting. Font family, size, line-height, and surface themes dynamically style Focus
                  Mode, notes, annotations, and reading overlays.
                </span>
              </div>

              <div className="settings-control-group">
                {/* Font Family */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Reader Font Family</h3>
                    <p className="settings-control-help">
                      High-legibility typefaces tailored for extended reading sanctuary sessions.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.fontFamily === 'serif' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'fontFamily', 'serif')}
                    >
                      <span>Serif (Playfair)</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.fontFamily === 'sans' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'fontFamily', 'sans')}
                    >
                      <span>Modern Sans</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.fontFamily === 'mono' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'fontFamily', 'mono')}
                    >
                      <span>Monospace</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.fontFamily === 'lexend' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'fontFamily', 'lexend')}
                    >
                      <span>Dyslexic Comfort</span>
                    </button>
                  </div>
                </div>

                {/* Font Size Slider */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Base Font Size</h3>
                    <p className="settings-control-help">
                      Configured between 12px (compact reference) and 28px (large comfort).
                    </p>
                  </div>
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min="12"
                      max="28"
                      step="1"
                      className="settings-range-slider"
                      value={currentValues.typography.fontSize}
                      onChange={(e) =>
                        updatePreference('typography', 'fontSize', Number(e.target.value))
                      }
                    />
                    <span className="settings-slider-value">
                      {currentValues.typography.fontSize}px
                    </span>
                  </div>
                </div>

                {/* Line Spacing */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Line Spacing (Leading)</h3>
                    <p className="settings-control-help">
                      Optimal spacing prevents eye strain during extended immersion.
                    </p>
                  </div>
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min="1.3"
                      max="2.2"
                      step="0.1"
                      className="settings-range-slider"
                      value={currentValues.typography.lineHeight}
                      onChange={(e) =>
                        updatePreference('typography', 'lineHeight', parseFloat(e.target.value))
                      }
                    />
                    <span className="settings-slider-value">
                      {currentValues.typography.lineHeight.toFixed(1)}x
                    </span>
                  </div>
                </div>

                {/* Page Margins */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Reading Margins</h3>
                    <p className="settings-control-help">
                      Breathing room between page borders and textual content.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.margins === 'compact' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'margins', 'compact')}
                    >
                      <span>Compact</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.margins === 'comfortable' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'margins', 'comfortable')}
                    >
                      <span>Comfortable</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.margins === 'spacious' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'margins', 'spacious')}
                    >
                      <span>Spacious</span>
                    </button>
                  </div>
                </div>

                {/* Reading Surface & Contrast Theme */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Reading Surface Contrast</h3>
                    <p className="settings-control-help">
                      Surface palette for Focus Mode text and sanctuary reading cards.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.surfaceTheme === 'navy' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'surfaceTheme', 'navy')}
                    >
                      <span>Dark Sanctuary</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.surfaceTheme === 'cream' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'surfaceTheme', 'cream')}
                    >
                      <span>Parchment</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.surfaceTheme === 'slate' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'surfaceTheme', 'slate')}
                    >
                      <span>Slate Night</span>
                    </button>
                    <button
                      className={`settings-segmented-btn ${currentValues.typography.surfaceTheme === 'contrast' ? 'active' : ''}`}
                      onClick={() => updatePreference('typography', 'surfaceTheme', 'contrast')}
                    >
                      <span>High Contrast</span>
                    </button>
                  </div>
                </div>

                {/* ── Interactive Live Typography Preview ────────────────────── */}
                <div
                  className={`settings-preview-box preview-surface-${currentValues.typography.surfaceTheme}`}
                  style={{
                    fontFamily:
                      currentValues.typography.fontFamily === 'serif'
                        ? 'var(--font-serif, "Playfair Display", Georgia, serif)'
                        : currentValues.typography.fontFamily === 'sans'
                        ? 'var(--font-sans, "Plus Jakarta Sans", sans-serif)'
                        : currentValues.typography.fontFamily === 'mono'
                        ? 'monospace'
                        : 'system-ui, sans-serif',
                    fontSize: `${currentValues.typography.fontSize}px`,
                    lineHeight: currentValues.typography.lineHeight,
                    padding:
                      currentValues.typography.margins === 'compact'
                        ? '1rem 1.25rem'
                        : currentValues.typography.margins === 'spacious'
                        ? '2rem 2.5rem'
                        : '1.5rem 1.75rem',
                  }}
                >
                  <div className="settings-preview-label">Live Sanctuary Reading Preview</div>
                  <h4 className="settings-preview-sample-heading">The Art of Contemplative Reading</h4>
                  <p className="settings-preview-sample-text">
                    "A sanctuary is not merely an escape from the noisy world, but a dedicated space where
                    words possess weight and quiet ideas unfold with clarity and grace."
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CATEGORY 3: BOOKMARKS & ANNOTATIONS
              ══════════════════════════════════════════════════════════════════ */}
          {activeCategory === 'annotations' && (
            <div className="settings-section-card">
              <div className="settings-section-header">
                <h2 className="settings-section-title">
                  <Bookmark size={20} className="text-gold" />
                  <span>Bookmarks & Annotations</span>
                  {hasBookOverride && (
                    <span className="settings-override-indicator">Overridden for Volume</span>
                  )}
                </h2>
                <p className="settings-section-desc">
                  Customize your default bookmark icon, marker colors, custom insignia uploads, and drawer preferences.
                </p>
              </div>

              <div className="settings-control-group">
                {/* Default Marker Style Picker */}
                <div className="settings-control-row vertical">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Default Bookmark Marker Emblem</h3>
                    <p className="settings-control-help">
                      Select the insignia displayed on page ribbons and in My Bookmarks.
                    </p>
                  </div>

                  <div className="settings-marker-grid" role="radiogroup">
                    <div
                      className={`settings-marker-card ${currentValues.annotations.defaultMarker === 'peacock-feather' ? 'active' : ''}`}
                      onClick={() => updatePreference('annotations', 'defaultMarker', 'peacock-feather')}
                    >
                      <div className="settings-marker-icon-box">
                        <Feather size={24} />
                      </div>
                      <span className="settings-marker-name">Peacock Feather</span>
                    </div>

                    <div
                      className={`settings-marker-card ${currentValues.annotations.defaultMarker === 'classic-ribbon' ? 'active' : ''}`}
                      onClick={() => updatePreference('annotations', 'defaultMarker', 'classic-ribbon')}
                    >
                      <div className="settings-marker-icon-box">
                        <Bookmark size={24} />
                      </div>
                      <span className="settings-marker-name">Silk Ribbon</span>
                    </div>

                    <div
                      className={`settings-marker-card ${currentValues.annotations.defaultMarker === 'geometric-leaf' ? 'active' : ''}`}
                      onClick={() => updatePreference('annotations', 'defaultMarker', 'geometric-leaf')}
                    >
                      <div className="settings-marker-icon-box">
                        <Sparkles size={24} />
                      </div>
                      <span className="settings-marker-name">Sanctuary Leaf</span>
                    </div>

                    <div
                      className={`settings-marker-card ${currentValues.annotations.defaultMarker === 'modern-pin' ? 'active' : ''}`}
                      onClick={() => updatePreference('annotations', 'defaultMarker', 'modern-pin')}
                    >
                      <div className="settings-marker-icon-box">
                        <CheckCircle2 size={24} />
                      </div>
                      <span className="settings-marker-name">Modern Seal</span>
                    </div>
                  </div>
                </div>

                {/* Marker Color Selection */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Marker Accent Color</h3>
                    <p className="settings-control-help">
                      Primary ribbon and emblem tint applied across your saved bookmarks.
                    </p>
                  </div>
                  <div className="settings-swatch-row">
                    {MARKER_COLORS.map((c) => (
                      <button
                        key={c.id}
                        className={`settings-color-swatch ${currentValues.annotations.markerColor === c.id ? 'active' : ''}`}
                        style={{ backgroundColor: c.bg }}
                        onClick={() => updatePreference('annotations', 'markerColor', c.id)}
                        title={c.label}
                        aria-label={c.label}
                      >
                        {currentValues.annotations.markerColor === c.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Marker Emblem Upload */}
                <div className="settings-control-row vertical">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Custom Bookmark Insignia Upload</h3>
                    <p className="settings-control-help">
                      Upload a custom PNG, SVG, or WebP graphic (&lt; 2MB) for your personal bookmark seal.
                    </p>
                  </div>

                  <div className="settings-upload-zone">
                    <label className="settings-upload-btn">
                      <Upload size={14} />
                      <span>Choose Custom Marker Image</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        style={{ display: 'none' }}
                        onChange={handleCustomMarkerUpload}
                      />
                    </label>

                    {currentValues.annotations.customMarkerUrl && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <img
                          src={currentValues.annotations.customMarkerUrl}
                          alt="Custom marker preview"
                          className="settings-upload-preview"
                        />
                        <button
                          className="settings-reset-override-btn"
                          onClick={() => {
                            updatePreference('annotations', 'customMarkerUrl', null);
                            updatePreference('annotations', 'defaultMarker', 'peacock-feather');
                          }}
                        >
                          <RotateCcw size={12} />
                          <span>Reset</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {uploadError && (
                    <div style={{ color: '#F87171', fontSize: '0.8125rem' }}>{uploadError}</div>
                  )}
                </div>

                {/* Default Text Highlight Color */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Default Passage Highlight Hue</h3>
                    <p className="settings-control-help">
                      Color used when highlighting passages in text overlays and revision notes.
                    </p>
                  </div>
                  <div className="settings-swatch-row">
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        className={`settings-color-swatch ${currentValues.annotations.defaultHighlightColor === c.id ? 'active' : ''}`}
                        style={{ backgroundColor: c.bg }}
                        onClick={() => updatePreference('annotations', 'defaultHighlightColor', c.id)}
                        title={c.label}
                        aria-label={c.label}
                      >
                        {currentValues.annotations.defaultHighlightColor === c.id && (
                          <Check size={14} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Show Timestamps on Notes */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Display Note Timestamps</h3>
                    <p className="settings-control-help">
                      Show creation and modification dates on notes and bookmark cards.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.annotations.showTimestamps}
                      onChange={(e) =>
                        updatePreference('annotations', 'showTimestamps', e.target.checked)
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                {/* Auto-Open Notes Drawer */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Auto-Open Notes Drawer</h3>
                    <p className="settings-control-help">
                      Automatically slide open the Notes Drawer when creating an annotation in the Reading Room.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.annotations.autoOpenDrawer}
                      onChange={(e) =>
                        updatePreference('annotations', 'autoOpenDrawer', e.target.checked)
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CATEGORY 4: BACKGROUND & APPEARANCE
              ══════════════════════════════════════════════════════════════════ */}
          {activeCategory === 'background' && (
            <div className="settings-section-card">
              <div className="settings-section-header">
                <div>
                  <h2 className="settings-section-title">
                    <ImageIcon size={20} className="text-gold" />
                    <span>Background & Appearance</span>
                  </h2>
                  <p className="settings-section-desc">
                    Personalize your reading sanctuary with the signature Aks library aesthetic or your own custom photo or video background.
                  </p>
                </div>
              </div>

              {/* Two Primary Options: Option A (Classic) vs Option B (Upload Your Own) */}
              <div className="settings-bg-options-grid">
                {/* Option A — Classic */}
                <div
                  className={`settings-bg-option-card ${bgMode === 'classic' && !stagedMedia ? 'active' : ''}`}
                  onClick={() => handleSelectClassic()}
                  role="button"
                  tabIndex={0}
                  aria-pressed={bgMode === 'classic' && !stagedMedia}
                >
                  <div className="settings-bg-option-header">
                    <div className="settings-bg-option-title-row">
                      <div className="settings-bg-option-icon">
                        <Sparkles size={16} />
                      </div>
                      <span className="settings-bg-option-name">Option A — Classic</span>
                    </div>
                    {bgMode === 'classic' && !stagedMedia && (
                      <span className="settings-bg-option-badge">
                        <Check size={11} />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="settings-bg-option-desc">
                    The signature Aks sanctuary dark-blue aesthetic and continuous atmospheric library background. Preserves built-in artwork without clearing custom uploads.
                  </p>
                  <div className="settings-bg-option-preview">
                    <img
                      src="/hero-image.png"
                      alt="Classic Aks Sanctuary Library"
                    />
                  </div>
                </div>

                {/* Option B — Upload Your Own */}
                <div
                  className={`settings-bg-option-card ${(bgMode === 'custom' || stagedMedia) ? 'active' : ''}`}
                  onClick={() => handleSelectUploadMode()}
                  role="button"
                  tabIndex={0}
                  aria-pressed={bgMode === 'custom' || !!stagedMedia}
                >
                  <div className="settings-bg-option-header">
                    <div className="settings-bg-option-title-row">
                      <div className="settings-bg-option-icon">
                        <Upload size={16} />
                      </div>
                      <span className="settings-bg-option-name">Option B — Upload Your Own</span>
                    </div>
                    {bgMode === 'custom' && !stagedMedia && (
                      <span className="settings-bg-option-badge">
                        <Check size={11} />
                        Active
                      </span>
                    )}
                    {stagedMedia && (
                      <span className="settings-bg-option-badge" style={{ background: 'rgba(231, 193, 138, 0.25)', borderColor: 'rgba(231, 193, 138, 0.45)', color: 'var(--accent-gold)' }}>
                        Previewing
                      </span>
                    )}
                  </div>
                  <p className="settings-bg-option-desc">
                    Bring your own visual aesthetic with a personal photo (JPG, PNG, WebP) or cinematic looping video (MP4, WebM) for full atmosphere immersion.
                  </p>
                  <div className="settings-bg-option-preview">
                    {stagedMedia?.url || customMedia?.url ? (
                      (stagedMedia?.type || customMedia?.type) === 'video' ? (
                        <video
                          src={stagedMedia?.url || customMedia?.url}
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img
                          src={stagedMedia?.url || customMedia?.url}
                          alt="Custom background preview"
                        />
                      )
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.8rem', gap: '4px' }}>
                        <Upload size={20} />
                        <span>No file uploaded yet</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Option C — Pure White */}
                <div
                  className={`settings-bg-option-card ${bgMode === 'pure-white' && !stagedMedia ? 'active' : ''}`}
                  onClick={() => handleSelectPureWhite()}
                  role="button"
                  tabIndex={0}
                  aria-pressed={bgMode === 'pure-white' && !stagedMedia}
                >
                  <div className="settings-bg-option-header">
                    <div className="settings-bg-option-title-row">
                      <div className="settings-bg-option-icon">
                        <Sun size={16} />
                      </div>
                      <span className="settings-bg-option-name">Option C — Pure White</span>
                    </div>
                    {bgMode === 'pure-white' && !stagedMedia && (
                      <span className="settings-bg-option-badge">
                        <Check size={11} />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="settings-bg-option-desc">
                    A clean, minimal white background with #F5F5F5 panels, #171717 primary text, and subtle light-grey borders for high daytime readability.
                  </p>
                  <div className="settings-bg-option-preview settings-bg-preview-pure-white">
                    <div className="preview-canvas-white">
                      <div className="preview-mini-topbar-white">
                        <div className="preview-dot" style={{ background: '#171717' }} />
                        <div className="preview-bar-search-white" />
                      </div>
                      <div className="preview-mini-card-white">
                        <div className="preview-mini-title-white" />
                        <div className="preview-mini-desc-white" />
                        <div className="preview-mini-badge-white" style={{ background: 'var(--theme-accent, #E7C18A)' }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Option D — Pure Black */}
                <div
                  className={`settings-bg-option-card ${bgMode === 'pure-black' && !stagedMedia ? 'active' : ''}`}
                  onClick={() => handleSelectPureBlack()}
                  role="button"
                  tabIndex={0}
                  aria-pressed={bgMode === 'pure-black' && !stagedMedia}
                >
                  <div className="settings-bg-option-header">
                    <div className="settings-bg-option-title-row">
                      <div className="settings-bg-option-icon">
                        <Moon size={16} />
                      </div>
                      <span className="settings-bg-option-name">Option D — Pure Black</span>
                    </div>
                    {bgMode === 'pure-black' && !stagedMedia && (
                      <span className="settings-bg-option-badge">
                        <Check size={11} />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="settings-bg-option-desc">
                    A true black reading environment with #000000 depth, #101010 panels, #FFFFFF primary text, and dark-grey borders for zero-glare immersion.
                  </p>
                  <div className="settings-bg-option-preview settings-bg-preview-pure-black">
                    <div className="preview-canvas-black">
                      <div className="preview-mini-topbar-black">
                        <div className="preview-dot" style={{ background: '#FFFFFF' }} />
                        <div className="preview-bar-search-black" />
                      </div>
                      <div className="preview-mini-card-black">
                        <div className="preview-mini-title-black" />
                        <div className="preview-mini-desc-black" />
                        <div className="preview-mini-badge-black" style={{ background: 'var(--theme-accent, #E7C18A)' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload & Display Controls Area */}
              <div className="settings-control-group">
                {/* File Dropzone & Selector */}
                <div
                  className={`settings-drop-zone ${isDragging ? 'drag-active' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload background image or video"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange}
                  />
                  <div className="settings-drop-zone-icon">
                    <Upload size={22} />
                  </div>
                  <div className="settings-drop-zone-title">
                    Click to browse or drag & drop photo or video
                  </div>
                  <div className="settings-drop-zone-caption">
                    Supported: JPG, PNG, WebP (up to 15MB) and MP4, WebM (up to 50MB). Stored safely and persistently in your local browser sandbox.
                  </div>
                </div>

                {bgError && (
                  <div className="settings-hex-error-msg" style={{ marginTop: '0.5rem' }}>
                    <AlertCircle size={14} />
                    <span>{bgError}</span>
                  </div>
                )}

                {bgSuccess && (
                  <div style={{ color: 'var(--accent-teal)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
                    <CheckCircle2 size={14} />
                    <span>{bgSuccess}</span>
                  </div>
                )}

                {/* Staged or Active Custom Media Card */}
                {(stagedMedia || customMedia) && (
                  <div className="settings-media-card">
                    <div className="settings-media-preview-header">
                      <div className="settings-media-file-info">
                        {(stagedMedia?.type || customMedia?.type) === 'video' ? (
                          <Video size={18} className="text-gold" />
                        ) : (
                          <ImageIcon size={18} className="text-gold" />
                        )}
                        <span className="settings-media-file-name">
                          {stagedMedia?.name || customMedia?.name || 'Sanctuary Custom Media'}
                        </span>
                        {stagedMedia ? (
                          <span
                            className="settings-media-meta-tag tag-unapplied"
                            style={{
                              background: 'rgba(231, 193, 138, 0.2)',
                              border: '1px solid rgba(231, 193, 138, 0.4)',
                              color: 'var(--accent-gold)',
                            }}
                          >
                            Preview (Unapplied)
                          </span>
                        ) : bgMode === 'custom' && customMedia ? (
                          <span
                            className="settings-media-meta-tag tag-applied"
                            style={{
                              background: 'rgba(74, 222, 128, 0.18)',
                              border: '1px solid rgba(74, 222, 128, 0.4)',
                              color: '#4ADE80',
                            }}
                          >
                            <Check size={11} style={{ display: 'inline', marginRight: 3 }} />
                            Applied
                          </span>
                        ) : customMedia ? (
                          <span
                            className="settings-media-meta-tag tag-saved"
                            style={{
                              background: 'rgba(100, 116, 139, 0.2)',
                              border: '1px solid rgba(100, 116, 139, 0.4)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            Stored in Sanctuary
                          </span>
                        ) : null}
                      </div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {(stagedMedia?.type || customMedia?.type)?.toUpperCase()} • {formatFileSize(stagedMedia?.size || customMedia?.size)}
                      </span>
                    </div>

                    <div className="settings-media-preview-viewport">
                      {(stagedMedia?.type || customMedia?.type) === 'video' ? (
                        <video
                          src={stagedMedia?.url || customMedia?.url}
                          autoPlay={bgMotion}
                          loop
                          muted
                          playsInline
                          style={{
                            filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
                            objectPosition: bgPosition === 'top' ? 'center top' : bgPosition === 'bottom' ? 'center bottom' : 'center center',
                          }}
                        />
                      ) : (
                        <img
                          src={stagedMedia?.url || customMedia?.url}
                          alt="Background preview"
                          style={{
                            filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
                            objectPosition: bgPosition === 'top' ? 'center top' : bgPosition === 'bottom' ? 'center bottom' : 'center center',
                          }}
                        />
                      )}
                      {/* Dimming overlay representation */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: `rgba(8, 14, 25, ${0.45 + (bgDimming / 100) * 0.4})`,
                          pointerEvents: 'none',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Display Controls: Dimming Slider */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Background Dimming & Scrim</h3>
                    <p className="settings-control-help">
                      Controls darkening overlay for comfortable reading and text contrast.
                    </p>
                  </div>
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min="0"
                      max="80"
                      step="5"
                      className="settings-range-slider"
                      value={bgDimming}
                      onChange={(e) => handleDimmingChange(parseInt(e.target.value, 10))}
                    />
                    <span className="settings-slider-value">{bgDimming}%</span>
                  </div>
                </div>

                {/* Display Controls: Blur Slider */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Background Blur</h3>
                    <p className="settings-control-help">
                      Softens detail to keep reading materials and cards front and center.
                    </p>
                  </div>
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      className="settings-range-slider"
                      value={bgBlur}
                      onChange={(e) => handleBlurChange(parseInt(e.target.value, 10))}
                    />
                    <span className="settings-slider-value">{bgBlur}px</span>
                  </div>
                </div>

                {/* Positioning Controls */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Focal Positioning</h3>
                    <p className="settings-control-help">
                      Aligns the visual focus of your custom photo or video background.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      type="button"
                      className={`settings-segmented-btn ${bgPosition === 'top' ? 'active' : ''}`}
                      onClick={() => handlePositionChange('top')}
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      className={`settings-segmented-btn ${bgPosition === 'center' ? 'active' : ''}`}
                      onClick={() => handlePositionChange('center')}
                    >
                      Center
                    </button>
                    <button
                      type="button"
                      className={`settings-segmented-btn ${bgPosition === 'bottom' ? 'active' : ''}`}
                      onClick={() => handlePositionChange('bottom')}
                    >
                      Bottom
                    </button>
                  </div>
                </div>

                {/* Background Application Scope */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Application Scope</h3>
                    <p className="settings-control-help">
                      Choose where the custom background appears. Left sidebar artwork remains permanently preserved.
                    </p>
                  </div>
                  <div className="settings-segmented-group">
                    <button
                      type="button"
                      className={`settings-segmented-btn ${bgScope === 'home' ? 'active' : ''}`}
                      onClick={() => handleScopeChange('home')}
                    >
                      Home dashboard only
                    </button>
                    <button
                      type="button"
                      className={`settings-segmented-btn ${bgScope === 'all' ? 'active' : ''}`}
                      onClick={() => handleScopeChange('all')}
                    >
                      All main application pages
                    </button>
                  </div>
                </div>

                {/* Looping / Ambient Motion */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Looping Video & Motion</h3>
                    <p className="settings-control-help">
                      Play custom videos smoothly and silently in a muted loop.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={bgMotion}
                      onChange={(e) => handleMotionToggle(e.target.checked)}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                {/* Actions Row */}
                <div className="settings-actions-row">
                  {customMedia && (
                    <button
                      type="button"
                      className="settings-btn-danger"
                      onClick={handleRemoveBackground}
                      title="Delete uploaded background media from storage"
                    >
                      <Trash2 size={14} />
                      <span>Remove Background</span>
                    </button>
                  )}
                  {stagedMedia && (
                    <button
                      type="button"
                      className="settings-btn-cancel"
                      onClick={handleCancelBackground}
                    >
                      <X size={14} />
                      <span>Cancel</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-btn-apply"
                    onClick={handleApplyBackground}
                  >
                    <Check size={14} />
                    <span>Apply Background</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CATEGORY 5: THEME COLORS
              ══════════════════════════════════════════════════════════════════ */}
          {activeCategory === 'theme' && (
            <div className="settings-section-card">
              <div className="settings-section-header">
                <div>
                  <h2 className="settings-section-title">
                    <Palette size={20} className="text-gold" />
                    <span>Theme Colors</span>
                  </h2>
                  <p className="settings-section-desc">
                    Customize the application's foundational midnight navy and accent palette. Choose a preset or enter any custom HEX color.
                  </p>
                </div>
              </div>

              {/* 1. Primary Background Palette Customizer */}
              <div className="settings-control-group">
                <div className="settings-control-row vertical">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Primary Atmosphere Color</h3>
                    <p className="settings-control-help">
                      Sets the foundational background hue. Surface cards, elevated panels, and glass layers derive harmoniously from this tone.
                    </p>
                  </div>

                  {/* Preset Swatches */}
                  <div className="settings-theme-presets-grid">
                    {THEME_PRESETS.map((preset) => {
                      const isSelected = normalizeHex(themePrimary) === normalizeHex(preset.hex);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`settings-theme-preset-btn ${isSelected ? 'active' : ''}`}
                          onClick={() => handlePresetThemeClick(preset)}
                          title={`${preset.name} — ${preset.desc}`}
                        >
                          <span
                            className="settings-theme-preset-swatch"
                            style={{ backgroundColor: preset.hex }}
                          />
                          <span>{preset.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Native Color Picker & Exact HEX Input */}
                  <div className="settings-color-input-card">
                    <div className="settings-color-picker-flex">
                      {/* Native Color Trigger Button */}
                      <label className="settings-native-color-trigger" title="Open native color picker">
                        <span
                          className="settings-native-color-preview-circle"
                          style={{ backgroundColor: themePrimary }}
                        />
                        <span>Pick Custom Color</span>
                        <input
                          type="color"
                          className="settings-native-color-hidden"
                          value={normalizeHex(themePrimary)}
                          onChange={(e) => handleNativeColorChange(e.target.value)}
                        />
                      </label>

                      {/* Exact HEX Input Field */}
                      <div>
                        <div className={`settings-hex-input-wrap ${hexError ? 'is-invalid' : ''}`}>
                          <span className="settings-hex-prefix">#</span>
                          <input
                            type="text"
                            maxLength={7}
                            className="settings-hex-text-field"
                            value={primaryHexInput.replace(/^#/, '')}
                            onChange={(e) => handlePrimaryHexChange(e.target.value)}
                            placeholder="080E19"
                            aria-label="Hex color value"
                          />
                        </div>
                      </div>
                    </div>

                    {hexError && (
                      <div className="settings-hex-error-msg">
                        <AlertCircle size={13} />
                        <span>{hexError}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Optional Accent Color Customizer */}
                <div className="settings-control-row vertical">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Accent Highlight Color</h3>
                    <p className="settings-control-help">
                      Highlights icons, badges, borders, and reading emphasis throughout Aks. Champagne Gold is the classic default.
                    </p>
                  </div>

                  {/* Accent Presets */}
                  <div className="settings-theme-presets-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))' }}>
                    {ACCENT_PRESETS.map((acc) => {
                      const isSelected = normalizeHex(themeAccent) === normalizeHex(acc.hex);
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          className={`settings-theme-preset-btn ${isSelected ? 'active' : ''}`}
                          onClick={() => handleAccentPresetClick(acc)}
                          title={acc.name}
                        >
                          <span
                            className="settings-theme-preset-swatch"
                            style={{ backgroundColor: acc.hex }}
                          />
                          <span>{acc.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Native Accent Picker & HEX Input */}
                  <div className="settings-color-input-card">
                    <div className="settings-color-picker-flex">
                      <label className="settings-native-color-trigger" title="Open native accent picker">
                        <span
                          className="settings-native-color-preview-circle"
                          style={{ backgroundColor: themeAccent }}
                        />
                        <span>Pick Custom Accent</span>
                        <input
                          type="color"
                          className="settings-native-color-hidden"
                          value={normalizeHex(themeAccent)}
                          onChange={(e) => handleNativeAccentChange(e.target.value)}
                        />
                      </label>

                      <div className="settings-hex-input-wrap">
                        <span className="settings-hex-prefix">#</span>
                        <input
                          type="text"
                          maxLength={7}
                          className="settings-hex-text-field"
                          value={accentHexInput.replace(/^#/, '')}
                          onChange={(e) => handleAccentHexChange(e.target.value)}
                          placeholder="E7C18A"
                          aria-label="Accent hex color value"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Theme Showcase */}
                <div className="settings-theme-showcase">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 className="settings-theme-showcase-title">
                      Live Sanctuary Palette Preview
                    </h4>
                    <span style={{ fontSize: '0.78rem', color: 'var(--accent-gold)' }}>
                      {normalizeHex(themePrimary)} • {normalizeHex(themeAccent)}
                    </span>
                  </div>
                  <p className="settings-theme-showcase-p">
                    Surfaces, cards, navigation, and accents update dynamically while preserving clear reading contrast, book covers, and photographs.
                  </p>
                  <div className="settings-theme-showcase-row">
                    <div
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '10px',
                        background: 'var(--bg-card-elevated)',
                        border: '1px solid var(--border-medium)',
                        color: 'var(--text-ivory)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                      }}
                    >
                      Elevated Card Surface
                    </div>
                    <div
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '10px',
                        background: 'var(--accent-gold)',
                        color: '#1A1308',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                      }}
                    >
                      Accent Gold Action
                    </div>
                    <div
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.82rem',
                      }}
                    >
                      Secondary Surface
                    </div>
                  </div>
                </div>

                {themeSuccess && (
                  <div style={{ color: 'var(--accent-teal)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
                    <CheckCircle2 size={14} />
                    <span>{themeSuccess}</span>
                  </div>
                )}

                {/* Theme Actions */}
                <div className="settings-actions-row">
                  <button
                    type="button"
                    className="settings-btn-cancel"
                    onClick={handleResetThemeToDefault}
                    title="Restore classic Aks midnight blue and champagne gold"
                  >
                    <RotateCcw size={14} />
                    <span>Reset to Default</span>
                  </button>
                  <button
                    type="button"
                    className="settings-btn-cancel"
                    onClick={handleCancelTheme}
                  >
                    <X size={14} />
                    <span>Cancel</span>
                  </button>
                  <button
                    type="button"
                    className="settings-btn-apply"
                    onClick={handleApplyTheme}
                  >
                    <Check size={14} />
                    <span>Apply Theme</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CATEGORY 5: DATA & STORAGE
              ══════════════════════════════════════════════════════════════════ */}
          {activeCategory === 'storage' && (
            <div className="settings-section-card">
              <div className="settings-section-header">
                <h2 className="settings-section-title">
                  <HardDrive size={20} className="text-gold" />
                  <span>Data & Storage</span>
                </h2>
                <p className="settings-section-desc">
                  Manage automatic progress persistence, export your reading notebook and bookmarks, or reset caches.
                </p>
              </div>

              <div className="settings-control-group">
                {/* Auto-Save Reading Progress */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Automatic Progress Synchronization</h3>
                    <p className="settings-control-help">
                      Save current page and reading milestones continuously to IndexedDB on every page turn.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.storage.autoSaveProgress}
                      onChange={(e) =>
                        updatePreference('storage', 'autoSaveProgress', e.target.checked)
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                {/* Auto-Save Notes */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Continuous Draft Note Auto-Save</h3>
                    <p className="settings-control-help">
                      Debounce-saves revisions to your notes notebook as you type.
                    </p>
                  </div>
                  <label className="settings-switch-label">
                    <input
                      type="checkbox"
                      className="settings-switch-input"
                      checked={currentValues.storage.autoSaveNotes}
                      onChange={(e) =>
                        updatePreference('storage', 'autoSaveNotes', e.target.checked)
                      }
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                {/* ── Guest Data Migration Section ─────────────────────────── */}
                <div className="settings-control-row">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Guest Sanctuary Data Migration</h3>
                    <p className="settings-control-help">
                      {currentUser
                        ? `Transfer offline guest books, bookmarks, and reflections into your account (${currentUser.email}). Local copies remain untouched.`
                        : 'Sign in to your account to transfer offline guest volumes and annotations to the cloud.'}
                    </p>
                  </div>
                  {currentUser ? (
                    <button
                      className="settings-action-btn secondary"
                      onClick={onOpenMigration}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
                    >
                      <Feather size={14} className="text-gold" />
                      <span>Review Migration</span>
                    </button>
                  ) : (
                    <button
                      className="settings-action-btn secondary"
                      onClick={() => onNavigateTo && onNavigateTo('login')}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Sign In to Migrate
                    </button>
                  )}
                </div>

                {/* ── Real Data Export Section ──────────────────────────────── */}
                <div className="settings-control-row vertical">
                  <div className="settings-control-meta">
                    <h3 className="settings-control-label">Data Portability & Sanctuary Exports</h3>
                    <p className="settings-control-help">
                      Download formatted copies of your notes, bookmarks, and catalog for offline safekeeping.
                    </p>
                  </div>

                  <div className="settings-export-grid">
                    {/* Export Notes MD */}
                    <div className="settings-export-card">
                      <div className="settings-export-icon">
                        <FileText size={18} />
                      </div>
                      <h4 className="settings-export-title">Notes as Markdown (.md)</h4>
                      <p className="settings-export-desc">
                        Formatted Markdown document with headings, citations, and timestamps for Obsidian/Notion.
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="settings-download-btn"
                          onClick={() => exportNotesAsMarkdown(allNotes)}
                        >
                          <Download size={13} />
                          <span>Markdown (.md)</span>
                        </button>
                        <button
                          className="settings-download-btn"
                          onClick={() => exportNotesAsJson(allNotes)}
                        >
                          <Download size={13} />
                          <span>JSON (.json)</span>
                        </button>
                      </div>
                    </div>

                    {/* Export Bookmarks JSON */}
                    <div className="settings-export-card">
                      <div className="settings-export-icon">
                        <Bookmark size={18} />
                      </div>
                      <h4 className="settings-export-title">Bookmarks (.json)</h4>
                      <p className="settings-export-desc">
                        Complete structured backup of all bookmarked pages, passages, and chapter labels.
                      </p>
                      <button
                        className="settings-download-btn"
                        onClick={() => exportBookmarksAsJson(books)}
                      >
                        <Download size={13} />
                        <span>Export JSON</span>
                      </button>
                    </div>

                    {/* Export Catalog Metadata */}
                    <div className="settings-export-card">
                      <div className="settings-export-icon">
                        <BookOpen size={18} />
                      </div>
                      <h4 className="settings-export-title">Library Metadata (.json)</h4>
                      <p className="settings-export-desc">
                        Export your volume list, authors, reading percentages, and categories.
                      </p>
                      <button
                        className="settings-download-btn"
                        onClick={() => exportLibraryMetadata(books)}
                      >
                        <Download size={13} />
                        <span>Export Catalog</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Future Cloud Sync Card ─────────────────────────────────── */}
                <div className="settings-cloud-banner">
                  <div className="settings-cloud-icon-halo">
                    <Cloud size={24} />
                  </div>
                  <div>
                    <div className="settings-cloud-title-row">
                      <h4 className="settings-cloud-title">Cloud Sanctuary Vault</h4>
                      <span className="settings-cloud-badge">Coming later</span>
                    </div>
                    <p className="settings-cloud-desc">
                      Cross-device encrypted synchronization and cloud backup are planned for a future update.
                      All your documents, reading marks, and notes currently remain 100% private and stored
                      locally on this device.
                    </p>
                  </div>
                </div>

                {/* ── Danger Zone: Clear Local Application Data ─────────────── */}
                <div className="settings-section-card settings-danger-card">
                  <div className="settings-section-header" style={{ marginBottom: '1rem' }}>
                    <h3 className="settings-section-title settings-danger-title">
                      <Trash2 size={18} />
                      <span>Sanctuary Preferences Reset</span>
                    </h3>
                    <p className="settings-section-desc">
                      Reset all visual preferences, reader configurations, and book overrides back to factory
                      defaults. Your saved PDFs and IndexedDB reading records will not be lost.
                    </p>
                  </div>

                  <button
                    className="settings-danger-btn"
                    onClick={() => setConfirmModal('clear-all')}
                  >
                    <RotateCcw size={14} />
                    <span>Reset All Sanctuary Preferences...</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── 6. Dedicated Account & Session / Log Out Section ────────────────── */}
      <section className="settings-account-section" aria-label="Account and session settings">
        <div className="settings-account-card">
          <div className="settings-account-info">
            <div className="settings-account-avatar">
              <span>{currentUser?.name ? currentUser.name.slice(0, 2).toUpperCase() : 'अक्स'}</span>
            </div>
            <div className="settings-account-details">
              <h3 className="settings-account-title">
                {currentUser?.name ? `Signed in as ${currentUser.name}` : 'Aks Sanctuary Account'}
              </h3>
              <p className="settings-account-desc">
                {currentUser?.email
                  ? `${currentUser.email} · Active reading session`
                  : 'You are currently enjoying the reading sanctuary with full local persistence.'}
              </p>
            </div>
          </div>

          <div className="settings-account-action">
            <button
              type="button"
              className="settings-logout-btn"
              onClick={() => setConfirmModal('logout')}
              aria-label="Log Out of Aks Sanctuary"
            >
              <LogOut size={15} />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Confirmation Modal ─────────────────────────────────────────────── */}
      {confirmModal && (
        <div
          className="settings-modal-backdrop"
          onClick={() => setConfirmModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <div className={confirmModal === 'logout' ? 'settings-modal-icon-logout' : 'settings-modal-icon-danger'}>
                {confirmModal === 'logout' ? <LogOut size={22} /> : <AlertCircle size={22} />}
              </div>
              <h3 className="settings-modal-title">
                {confirmModal === 'clear-all'
                  ? 'Reset Sanctuary Preferences?'
                  : confirmModal === 'logout'
                  ? 'Log Out of Aks?'
                  : `Reset Overrides for "${targetBook?.title}"?`}
              </h3>
            </div>

            <div className="settings-modal-body">
              {confirmModal === 'clear-all' ? (
                <>
                  This will restore all global reading, typography, annotation, and atmosphere settings
                  to their pristine defaults, and remove all custom per-book overrides.
                  <br />
                  <br />
                  <strong>Your saved books, notes, and bookmarks will be safely preserved.</strong>
                </>
              ) : confirmModal === 'logout' ? (
                <>
                  Are you sure you want to log out?
                  <br />
                  <br />
                  <span className="settings-modal-subtext">
                    Your reading progress, books, bookmarks, highlights, notes, study time, and atmosphere settings will remain safely preserved on this device.
                  </span>
                </>
              ) : (
                <>
                  This will remove all custom reading and typography overrides for{' '}
                  <strong>{targetBook?.title}</strong>. This volume will inherit your global sanctuary
                  defaults.
                </>
              )}
            </div>

            <div className="settings-modal-actions">
              <button className="settings-modal-cancel" onClick={() => setConfirmModal(null)}>
                Cancel
              </button>
              {confirmModal === 'logout' ? (
                <button
                  className="settings-modal-logout-btn"
                  onClick={handleConfirmLogout}
                >
                  Log Out
                </button>
              ) : (
                <button
                  className="settings-danger-btn"
                  onClick={confirmModal === 'clear-all' ? handleConfirmClearAll : handleResetEntireBook}
                >
                  {confirmModal === 'clear-all' ? 'Reset All Preferences' : 'Remove Overrides'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
