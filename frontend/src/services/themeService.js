/**
 * themeService.js
 * Theme color engine for Aks.
 * Dynamically computes and applies custom primary & accent palettes via CSS variables.
 */

export const DEFAULT_THEME = {
  primaryColor: '#080E19', // Midnight Blue
  accentColor: '#E7C18A',  // Champagne Gold
  isCustom: false,
};

export const THEME_PRESETS = [
  { id: 'midnight', name: 'Midnight Blue', hex: '#080E19', desc: 'Classic Aks sanctuary' },
  { id: 'teal', name: 'Peacock Teal', hex: '#082124', desc: 'Deep ocean tranquility' },
  { id: 'forest', name: 'Forest Green', hex: '#092218', desc: 'Ancient woodland peace' },
  { id: 'burgundy', name: 'Royal Burgundy', hex: '#240B18', desc: 'Rich velvet intimacy' },
  { id: 'violet', name: 'Celestial Violet', hex: '#180D2D', desc: 'Twilight contemplation' },
  { id: 'charcoal', name: 'Obsidian Charcoal', hex: '#111317', desc: 'Pure minimalist dark' },
  { id: 'brown', name: 'Warm Literary', hex: '#19110A', desc: 'Leather & aged parchment' },
];

export const ACCENT_PRESETS = [
  { id: 'gold', name: 'Champagne Gold', hex: '#E7C18A' },
  { id: 'teal', name: 'Peacock Teal', hex: '#67B8A2' },
  { id: 'rose', name: 'Coral Rose', hex: '#E28B8B' },
  { id: 'amber', name: 'Warm Amber', hex: '#F59E0B' },
  { id: 'amethyst', name: 'Amethyst Violet', hex: '#B886EE' },
  { id: 'emerald', name: 'Emerald Green', hex: '#4ADE80' },
  { id: 'cyan', name: 'Ice Cyan', hex: '#38BDF8' },
];

/**
 * Validates a HEX color code (e.g. #080E19, 080e19, #08E, 08E).
 */
export function isValidHex(hex) {
  if (typeof hex !== 'string') return false;
  const clean = hex.trim();
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(clean);
}

/**
 * Normalizes HEX string to 6-digit #RRGGBB.
 */
export function normalizeHex(hex) {
  if (!isValidHex(hex)) return DEFAULT_THEME.primaryColor;
  let clean = hex.trim();
  if (!clean.startsWith('#')) clean = `#${clean}`;
  if (clean.length === 4) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`.toUpperCase();
  }
  return clean.toUpperCase();
}

/**
 * Converts a hex string to RGB object { r, g, b }.
 */
export function hexToRgb(hex) {
  const norm = normalizeHex(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * Helper to adjust brightness of an RGB component.
 */
function clamp(val) {
  return Math.min(255, Math.max(0, Math.round(val)));
}

/**
 * Derives surface color tokens from a primary background color, an accent color, and backgroundMode.
 */
export function deriveThemeTokens(primaryHex, accentHex, backgroundMode = 'classic') {
  const a = hexToRgb(accentHex);
  const accentLum = 0.299 * a.r + 0.587 * a.g + 0.114 * a.b;
  const accentTextColor = accentLum > 140 ? '#171717' : '#FFFFFF';

  // Lightened accent for hover
  const accHoverR = clamp(a.r + 18);
  const accHoverG = clamp(a.g + 18);
  const accHoverB = clamp(a.b + 18);

  // ── Option C: Pure White Mode ──
  if (backgroundMode === 'pure-white') {
    return {
      '--theme-primary': '#FFFFFF',
      '--theme-primary-dark': '#F0F0F0',
      '--theme-primary-surface': '#F5F5F5',
      '--theme-primary-hover': '#EDEDED',
      '--theme-primary-elevated': '#FFFFFF',
      '--theme-primary-glass': 'rgba(255, 255, 255, 0.92)',
      '--theme-sidebar': '#FAFAFA',
      '--theme-sidebar-rgb': '250, 250, 250',

      '--theme-accent': accentHex,
      '--theme-accent-hover': `rgb(${accHoverR}, ${accHoverG}, ${accHoverB})`,
      '--theme-accent-soft': `rgba(${a.r}, ${a.g}, ${a.b}, 0.12)`,
      '--theme-accent-glow': `rgba(${a.r}, ${a.g}, ${a.b}, 0.2)`,
      '--theme-accent-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.3)`,
      '--theme-accent-text': accentTextColor,

      '--theme-border': 'rgba(0, 0, 0, 0.08)',
      '--theme-border-medium': 'rgba(0, 0, 0, 0.14)',
      '--theme-border-highlight': 'rgba(0, 0, 0, 0.24)',

      '--theme-text': '#171717',
      '--theme-text-secondary': '#666666',
      '--theme-text-muted': '#888888',
      '--theme-muted-text': '#888888',

      // Backward-compatible Aliases
      '--bg-midnight': '#FFFFFF',
      '--bg-sidebar': '#FAFAFA',
      '--bg-card': '#F5F5F5',
      '--bg-card-hover': '#EDEDED',
      '--bg-card-elevated': '#FFFFFF',
      '--bg-glass': 'rgba(255, 255, 255, 0.92)',

      '--text-ivory': '#171717',
      '--text-primary': '#171717',
      '--text-secondary': '#666666',
      '--text-muted': '#888888',
      '--text-dim': '#999999',

      '--border-subtle': 'rgba(0, 0, 0, 0.08)',
      '--border-medium': 'rgba(0, 0, 0, 0.14)',
      '--border-highlight': 'rgba(0, 0, 0, 0.24)',

      '--accent-gold': accentHex,
      '--accent-gold-hover': `rgb(${accHoverR}, ${accHoverG}, ${accHoverB})`,
      '--accent-gold-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.3)`,
      '--accent-gold-glow': `rgba(${a.r}, ${a.g}, ${a.b}, 0.2)`,
      '--accent-gold-dim': `rgba(${a.r}, ${a.g}, ${a.b}, 0.12)`,
    };
  }

  // ── Option D: Pure Black Mode ──
  if (backgroundMode === 'pure-black') {
    return {
      '--theme-primary': '#000000',
      '--theme-primary-dark': '#000000',
      '--theme-primary-surface': '#101010',
      '--theme-primary-hover': '#181818',
      '--theme-primary-elevated': '#141414',
      '--theme-primary-glass': 'rgba(16, 16, 16, 0.92)',
      '--theme-sidebar': '#080808',
      '--theme-sidebar-rgb': '8, 8, 8',

      '--theme-accent': accentHex,
      '--theme-accent-hover': `rgb(${accHoverR}, ${accHoverG}, ${accHoverB})`,
      '--theme-accent-soft': `rgba(${a.r}, ${a.g}, ${a.b}, 0.15)`,
      '--theme-accent-glow': `rgba(${a.r}, ${a.g}, ${a.b}, 0.28)`,
      '--theme-accent-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.25)`,
      '--theme-accent-text': accentTextColor,

      '--theme-border': 'rgba(255, 255, 255, 0.1)',
      '--theme-border-medium': 'rgba(255, 255, 255, 0.18)',
      '--theme-border-highlight': 'rgba(255, 255, 255, 0.3)',

      '--theme-text': '#FFFFFF',
      '--theme-text-secondary': '#A3A3A3',
      '--theme-text-muted': '#737373',
      '--theme-muted-text': '#737373',

      // Backward-compatible Aliases
      '--bg-midnight': '#000000',
      '--bg-sidebar': '#080808',
      '--bg-card': '#101010',
      '--bg-card-hover': '#181818',
      '--bg-card-elevated': '#141414',
      '--bg-glass': 'rgba(16, 16, 16, 0.92)',

      '--text-ivory': '#FFFFFF',
      '--text-primary': '#FFFFFF',
      '--text-secondary': '#A3A3A3',
      '--text-muted': '#737373',
      '--text-dim': '#666666',

      '--border-subtle': 'rgba(255, 255, 255, 0.1)',
      '--border-medium': 'rgba(255, 255, 255, 0.18)',
      '--border-highlight': 'rgba(255, 255, 255, 0.3)',

      '--accent-gold': accentHex,
      '--accent-gold-hover': `rgb(${accHoverR}, ${accHoverG}, ${accHoverB})`,
      '--accent-gold-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.25)`,
      '--accent-gold-glow': `rgba(${a.r}, ${a.g}, ${a.b}, 0.28)`,
      '--accent-gold-dim': `rgba(${a.r}, ${a.g}, ${a.b}, 0.15)`,
    };
  }

  // ── Option A (Classic) & Option B (Custom) Sanctuary Palette ──
  const p = hexToRgb(primaryHex);

  const cardR = clamp(p.r + 9);
  const cardG = clamp(p.g + 13);
  const cardB = clamp(p.b + 19);

  const hoverR = clamp(p.r + 16);
  const hoverG = clamp(p.g + 22);
  const hoverB = clamp(p.b + 32);

  const elevR = clamp(p.r + 13);
  const elevG = clamp(p.g + 18);
  const elevB = clamp(p.b + 26);

  const glassR = clamp(p.r + 5);
  const glassG = clamp(p.g + 8);
  const glassB = clamp(p.b + 13);

  const sideR = clamp(p.r * 0.7);
  const sideG = clamp(p.g * 0.7);
  const sideB = clamp(p.b * 0.7);

  return {
    // ── Global Theme System Custom Properties ──
    '--theme-primary': primaryHex,
    '--theme-primary-dark': `rgb(${sideR}, ${sideG}, ${sideB})`,
    '--theme-primary-surface': `rgba(${cardR}, ${cardG}, ${cardB}, 0.65)`,
    '--theme-primary-hover': `rgba(${hoverR}, ${hoverG}, ${hoverB}, 0.75)`,
    '--theme-primary-elevated': `rgba(${elevR}, ${elevG}, ${elevB}, 0.85)`,
    '--theme-primary-glass': `rgba(${glassR}, ${glassG}, ${glassB}, 0.7)`,
    '--theme-sidebar': `rgb(${sideR}, ${sideG}, ${sideB})`,
    '--theme-sidebar-rgb': `${sideR}, ${sideG}, ${sideB}`,

    '--theme-accent': accentHex,
    '--theme-accent-hover': `rgb(${accHoverR}, ${accHoverG}, ${accHoverB})`,
    '--theme-accent-soft': `rgba(${a.r}, ${a.g}, ${a.b}, 0.15)`,
    '--theme-accent-glow': `rgba(${a.r}, ${a.g}, ${a.b}, 0.25)`,
    '--theme-accent-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.22)`,
    '--theme-accent-text': accentTextColor,

    '--theme-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.12)`,
    '--theme-border-medium': `rgba(${a.r}, ${a.g}, ${a.b}, 0.22)`,
    '--theme-border-highlight': `rgba(${a.r}, ${a.g}, ${a.b}, 0.38)`,

    '--theme-text': '#F4E9D7',
    '--theme-text-muted': '#9DAEC5',

    // ── Backward-compatible Aliases ──
    '--bg-midnight': primaryHex,
    '--bg-sidebar': `rgb(${sideR}, ${sideG}, ${sideB})`,
    '--bg-card': `rgba(${cardR}, ${cardG}, ${cardB}, 0.65)`,
    '--bg-card-hover': `rgba(${hoverR}, ${hoverG}, ${hoverB}, 0.75)`,
    '--bg-card-elevated': `rgba(${elevR}, ${elevG}, ${elevB}, 0.85)`,
    '--bg-glass': `rgba(${glassR}, ${glassG}, ${glassB}, 0.7)`,

    '--text-ivory': '#F4E9D7',
    '--text-primary': '#F4E9D7',
    '--text-secondary': '#9DAEC5',
    '--text-muted': '#64748B',
    '--text-dim': '#4B5A70',

    '--border-subtle': `rgba(${a.r}, ${a.g}, ${a.b}, 0.12)`,
    '--border-medium': `rgba(${a.r}, ${a.g}, ${a.b}, 0.22)`,
    '--border-highlight': `rgba(${a.r}, ${a.g}, ${a.b}, 0.38)`,

    '--accent-gold': accentHex,
    '--accent-gold-hover': `rgb(${accHoverR}, ${accHoverG}, ${accHoverB})`,
    '--accent-gold-border': `rgba(${a.r}, ${a.g}, ${a.b}, 0.22)`,
    '--accent-gold-glow': `rgba(${a.r}, ${a.g}, ${a.b}, 0.25)`,
    '--accent-gold-dim': `rgba(${a.r}, ${a.g}, ${a.b}, 0.15)`,
  };
}

/**
 * Injects custom theme tokens into document.documentElement and document.body.
 */
export function applyTheme(theme, backgroundMode = 'classic') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;

  const primary = normalizeHex(theme?.primaryColor || DEFAULT_THEME.primaryColor);
  const accent = normalizeHex(theme?.accentColor || DEFAULT_THEME.accentColor);
  const tokens = deriveThemeTokens(primary, accent, backgroundMode);

  Object.entries(tokens).forEach(([key, val]) => {
    root.style.setProperty(key, val);
    if (body) {
      body.style.setProperty(key, val);
    }
  });

  if (body) {
    // Mode classes
    body.classList.remove('bg-mode-classic', 'bg-mode-custom', 'bg-mode-pure-white', 'bg-mode-pure-black');
    body.classList.add(`bg-mode-${backgroundMode}`);

    const isCustom = Boolean(
      theme?.isCustom ||
      primary !== DEFAULT_THEME.primaryColor ||
      accent !== DEFAULT_THEME.accentColor
    );
    if (isCustom && backgroundMode !== 'pure-white' && backgroundMode !== 'pure-black') {
      body.classList.add('has-custom-theme');
    } else {
      body.classList.remove('has-custom-theme');
    }
  }
}
