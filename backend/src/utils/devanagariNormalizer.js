/**
 * Devanagari and Multilingual Search Normalizer (Version 1.0.0)
 *
 * Implements the search-oriented normalization rules from Aks Phase OCR-2.3:
 * - Unicode NFC composition
 * - Removal of invisible formatting characters (ZWJ, ZWNJ, soft hyphens)
 * - Punctuation canonicalization (Dandas, colons to Visargas)
 * - Chandrabindu to Anusvara canonicalization
 * - Pancham Varna (classical homorganic nasals) to Anusvara canonicalization
 * - Safe Nukta normalization (default: stripNuktas = false to prevent semantic collisions)
 *
 * IMPORTANT:
 * - This is used strictly for search token generation and search indexing.
 * - Never use normalized tokens to overwrite raw OCR transcripts or UI highlight coordinates.
 */

export const NORMALIZER_VERSION = '1.0.0';

// Devanagari Unicode Codepoints
const ANUSVARA = '\u0902';       // ं
const CHANDRABINDU = '\u0901';   // ँ
const VISARGA = '\u0903';        // ः
const NUKTA = '\u093C';          // ़
const DANDA = '\u0964';          // ।
const DOUBLE_DANDA = '\u0965';   // ॥
const ZWJ = '\u200D';            // Zero-width joiner
const ZWNJ = '\u200C';           // Zero-width non-joiner

// Homorganic nasal mappings for classical Devanagari conjuncts
const NASAL_PATTERNS = [
  { regex: /ङ्([कखगघ])/g, replacement: `${ANUSVARA}$1` },
  { regex: /ञ्([चछजझ])/g, replacement: `${ANUSVARA}$1` },
  { regex: /ण्([टठडढ])/g, replacement: `${ANUSVARA}$1` },
  { regex: /न्([तथदध])/g, replacement: `${ANUSVARA}$1` },
  { regex: /म्([पफबभ])/g, replacement: `${ANUSVARA}$1` },
];

// Pre-composed vs Decomposed Devanagari Nukta characters
const NUKTA_DECOMPOSED_MAP = {
  '\u0958': '\u0915\u093C', // क़ -> क + ़
  '\u0959': '\u0916\u093C', // ख़ -> ख + ़
  '\u095A': '\u0917\u093C', // ग़ -> ग + ़
  '\u095B': '\u091C\u093C', // ज़ -> ज + ़
  '\u095C': '\u0921\u093C', // ड़ -> ड + ़
  '\u095D': '\u0922\u093C', // ढ़ -> ढ + ़
  '\u095E': '\u092B\u093C', // फ़ -> फ + ़
  '\u095F': '\u092F\u093C', // य़ -> य + ़
};

export class DevanagariSearchNormalizer {
  static get VERSION() {
    return NORMALIZER_VERSION;
  }

  /**
   * Apply Unicode canonical composition (NFC) or decomposition (NFD).
   */
  static normalizeUnicode(text, form = 'NFC') {
    if (!text || typeof text !== 'string') return '';
    return text.normalize(form);
  }

  /**
   * Strip Zero-Width Joiner (ZWJ, U+200D), Non-Joiner (ZWNJ, U+200C), and soft hyphens.
   */
  static stripInvisibleFormatChars(text) {
    if (!text) return '';
    return text.replace(new RegExp(`[${ZWJ}${ZWNJ}\u00AD\uFEFF]`, 'g'), '');
  }

  /**
   * Normalize OCR punctuation artifacts:
   * - Pipe '|' or exclamation '!' to Danda '।'.
   * - Double pipe '||' or '!!' to Double Danda '॥'.
   * - Latin colon ':' preceded by Devanagari character to Visarga 'ः'.
   */
  static normalizePunctuation(text) {
    if (!text) return '';
    let out = text.replace(/[|!]{2,}/g, DOUBLE_DANDA);
    out = out.replace(/\s+[|!]\s*/g, ` ${DANDA} `);
    out = out.replace(/([\u0900-\u097F]):/g, `$1${VISARGA}`);
    return out;
  }

  /**
   * Convert Chandrabindu ('ँ', U+0901) to Anusvara ('ं', U+0902) for search equivalence.
   */
  static normalizeChandrabindu(text) {
    if (!text) return '';
    return text.replace(new RegExp(CHANDRABINDU, 'g'), ANUSVARA);
  }

  /**
   * Normalize classical Pancham Varna conjuncts to Anusvara:
   * e.g., 'सङ्कल्प' -> 'संकल्प', 'सम्बन्ध' -> 'संबंध', 'अन्तर' -> 'अंतर'.
   */
  static canonicalizePanchamVarna(text) {
    if (!text) return '';
    let out = text;
    for (const { regex, replacement } of NASAL_PATTERNS) {
      out = out.replace(regex, replacement);
    }
    return out;
  }

  /**
   * Apply both Chandrabindu and Pancham Varna normalization.
   */
  static normalizeNasalsAndBindus(text) {
    const cb = this.normalizeChandrabindu(text);
    return this.canonicalizePanchamVarna(cb);
  }

  /**
   * Standardize nuktas:
   * - stripNukta = false (DEFAULT): Normalizes to canonical NFC form without collapsing
   *   distinct minimal pairs like राज (kingdom) and राज़ (secret).
   * - stripNukta = true: Strips nukta codepoints entirely.
   */
  static normalizeNuktas(text, stripNukta = false) {
    if (!text) return '';
    let out = text.normalize('NFC');
    if (stripNukta) {
      out = out.replace(new RegExp(NUKTA, 'g'), '');
      for (const [precomp, decomp] of Object.entries(NUKTA_DECOMPOSED_MAP)) {
        const baseChar = decomp[0];
        out = out.replace(new RegExp(precomp, 'g'), baseChar);
      }
    }
    return out;
  }

  /**
   * Generate canonical search tokens for indexing and querying.
   *
   * @param {string} text - Raw or cleaned OCR/native text
   * @param {Object} [options]
   * @param {boolean} [options.stripNuktas=false] - Whether to strip nuktas (default: false)
   * @returns {string[]} Array of normalized unique search tokens
   */
  static toSearchTokens(text, options = {}) {
    if (!text || typeof text !== 'string') return [];
    const stripNuktas = Boolean(options.stripNuktas);

    let t = this.normalizeUnicode(text, 'NFC');
    t = this.stripInvisibleFormatChars(t);
    t = this.normalizePunctuation(t);
    t = this.normalizeNasalsAndBindus(t);
    t = this.normalizeNuktas(t, stripNuktas);

    // Replace punctuation, dandas, brackets, hyphens with whitespace
    t = t.replace(/[\.,;:!\?"'\(\)\[\]\{\}—–\-।॥\/\\@#\$%\^&\*\+=~`_<>]/g, ' ');

    // Tokenize, lowercase ASCII tokens, trim and filter empty/single punctuation tokens
    const tokens = t
      .split(/\s+/)
      .map((tok) => tok.trim())
      .filter((tok) => tok.length > 0)
      .map((tok) => {
        // Lowercase Latin characters while preserving Devanagari codepoints
        return tok.toLowerCase();
      });

    // Deduplicate tokens while preserving order
    const seen = new Set();
    const result = [];
    for (const tok of tokens) {
      if (!seen.has(tok)) {
        seen.add(tok);
        result.push(tok);
      }
    }

    return result;
  }
}

