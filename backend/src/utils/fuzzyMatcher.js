/**
 * Fuzzy Matching Utilities for Multilingual Search in Aks (अक्स)
 *
 * Implements bounded, typo-tolerant matching for Latin, Hindi, and Sanskrit:
 * - Levenshtein edit distance with length-dependent thresholds
 * - Normalized similarity ratio [0.0 - 1.0]
 * - Guardrails to prevent false-positive explosions on short words
 */

export class FuzzyMatcher {
  /**
   * Compute standard Levenshtein edit distance between two strings.
   *
   * @param {string} a
   * @param {string} b
   * @returns {number} Minimum number of single-character edits (insertions, deletions, substitutions)
   */
  static levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a) return b ? b.length : 0;
    if (!b) return a.length;

    const la = a.length;
    const lb = b.length;

    // Use two-row space optimization
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);

    for (let j = 0; j <= lb; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      const charA = a[i - 1];

      for (let j = 1; j <= lb; j++) {
        const charB = b[j - 1];
        const cost = charA === charB ? 0 : 1;

        curr[j] = Math.min(
          prev[j] + 1,       // deletion
          curr[j - 1] + 1,   // insertion
          prev[j - 1] + cost // substitution
        );
      }

      // Swap rows
      const temp = prev;
      prev = curr;
      curr = temp;
    }

    return prev[lb];
  }

  /**
   * Calculate similarity ratio between 0.0 and 1.0.
   * 1.0 = identical, 0.0 = completely dissimilar.
   */
  static similarity(a, b) {
    if (a === b) return 1.0;
    if (!a || !b) return 0.0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const dist = this.levenshteinDistance(a, b);
    return Math.max(0, (maxLen - dist) / maxLen);
  }

  /**
   * Determine if candidate word is a valid fuzzy match for the target word.
   *
   * Strict False-Positive Controls:
   * - Words < 4 characters: NO fuzzy matching permitted (prevents "in" matching "is", "at", "on").
   * - Words 4-7 characters: Max edit distance 1 (similarity >= 0.70).
   * - Words 8+ characters: Max edit distance 2 (similarity >= 0.60).
   *
   * @param {string} target - Query token
   * @param {string} candidate - Document token
   * @returns {{ isMatch: boolean, distance: number, similarity: number }}
   */
  static matchWord(target, candidate) {
    if (!target || !candidate) {
      return { isMatch: false, distance: Infinity, similarity: 0 };
    }

    const t = target.toLowerCase();
    const c = candidate.toLowerCase();

    if (t === c) {
      return { isMatch: true, distance: 0, similarity: 1.0 };
    }

    // Guardrail: disallow fuzzy matching on short words
    if (t.length < 4 || c.length < 3) {
      return { isMatch: false, distance: Infinity, similarity: 0 };
    }

    // Guardrail: Preserve Nukta distinctions by default to prevent semantic collisions
    // e.g. राज़ (secret) vs राज (kingdom), ज़रा (a little) vs जरा (old age)
    const NUKTA = '\u093C';
    if (t.includes(NUKTA) !== c.includes(NUKTA)) {
      const tNoNukta = t.replace(new RegExp(NUKTA, 'g'), '');
      const cNoNukta = c.replace(new RegExp(NUKTA, 'g'), '');
      if (tNoNukta === cNoNukta) {
        return { isMatch: false, distance: 1, similarity: 0 };
      }
    }

    // Length difference guard: reject if lengths differ by more than allowed edit distance
    const lengthDiff = Math.abs(t.length - c.length);
    const maxAllowedDist = t.length >= 8 ? 2 : 1;

    if (lengthDiff > maxAllowedDist) {
      return { isMatch: false, distance: lengthDiff, similarity: 0 };
    }

    const distance = this.levenshteinDistance(t, c);
    const similarity = (Math.max(t.length, c.length) - distance) / Math.max(t.length, c.length);

    const isMatch = distance <= maxAllowedDist && similarity >= (t.length >= 8 ? 0.60 : 0.70);

    return { isMatch, distance, similarity };
  }
}
