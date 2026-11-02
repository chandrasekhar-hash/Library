/**
 * Native PDF Text Extraction Service for Aks (अक्स)
 *
 * Implements Step 1 of the Hybrid Extraction Strategy:
 * - Uses pdfjs-dist legacy build to extract native digital text from PDF streams.
 * - Extracts text page-by-page.
 * - Evaluates usability (determines whether a page contains genuine text vs scanned images).
 * - Leaves original PDF completely unmodified.
 */

import fs from 'fs';

// Dynamically import pdfjs-dist legacy module
let pdfjsLibPromise = null;
async function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

export class NativeTextExtractor {
  /**
   * Determine whether extracted text from a page is considered usable.
   *
   * Usability Criteria:
   * 1. Extracted text is non-empty and has at least minChars characters (default 25).
   * 2. Contains at least minWords meaningful words (default 5 words with length > 1).
   * 3. Character density: text is not merely isolated whitespace or replacement characters.
   *
   * @param {string} text
   * @param {Object} [options]
   * @param {number} [options.minChars=25]
   * @param {number} [options.minWords=5]
   * @returns {boolean}
   */
  static isTextUsable(text, options = {}) {
    if (!text || typeof text !== 'string') return false;
    const minChars = options.minChars ?? 25;
    const minWords = options.minWords ?? 5;

    const trimmed = text.trim();
    if (trimmed.length < minChars) return false;

    // Filter out isolated punctuation / whitespace
    const words = trimmed
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((w) => w.length > 1);

    if (words.length < minWords) return false;

    // Filter out unprintable or placeholder glyph replacement artifacts
    const validAlphaNum = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
    if (validAlphaNum.length / trimmed.length < 0.3) {
      return false;
    }

    return true;
  }

  /**
   * Get total page count of a PDF file using read-only access.
   *
   * @param {string} pdfPath - Absolute path to PDF file
   * @returns {Promise<number>}
   */
  static async getPageCount(pdfPath) {
    const pdfjs = await getPdfjs();
    const buffer = await fs.promises.readFile(pdfPath);
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      stopAtErrors: false,
    }).promise;

    const count = doc.numPages;
    await doc.destroy();
    return count;
  }

  /**
   * Extract native text from a single 1-based page of a PDF.
   *
   * @param {string} pdfPath - Absolute path to PDF file
   * @param {number} pageNumber - 1-based page number
   * @param {Object} [options]
   * @returns {Promise<{
   *   pageNumber: number,
   *   isUsable: boolean,
   *   rawText: string,
   *   lineCount: number,
   *   lines: Array<{ text: string, confidence: number, bbox: number[][] }>,
   *   confidence: number,
   *   width: number,
   *   height: number
   * }>}
   */
  static async extractPageText(pdfPath, pageNumber, options = {}) {
    const pdfjs = await getPdfjs();
    const buffer = await fs.promises.readFile(pdfPath);
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      stopAtErrors: false,
    }).promise;

    try {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      const items = textContent.items || [];
      if (items.length === 0) {
        return {
          pageNumber,
          isUsable: false,
          rawText: '',
          lineCount: 0,
          lines: [],
          confidence: 0.0,
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
        };
      }

      // Group text items by Y-coordinate into structured lines
      // Items with similar transform[5] (Y coordinate) are grouped together
      const linesMap = new Map();
      const yTolerance = 4.0; // px threshold for same line

      for (const item of items) {
        if (!item.str || item.str.trim().length === 0) continue;
        const tx = item.transform[4] || 0;
        const ty = item.transform[5] || 0;
        const itemWidth = item.width || 0;
        const itemHeight = item.height || 10;

        // Find existing line bucket within yTolerance
        let bucketKey = null;
        for (const existingY of linesMap.keys()) {
          if (Math.abs(existingY - ty) <= yTolerance) {
            bucketKey = existingY;
            break;
          }
        }

        if (bucketKey === null) {
          bucketKey = ty;
          linesMap.set(bucketKey, []);
        }

        linesMap.get(bucketKey).push({
          str: item.str,
          x: tx,
          y: ty,
          width: itemWidth,
          height: itemHeight,
        });
      }

      // Sort lines top-to-bottom (in PDF coords, Y=0 is bottom, so sort descending by Y)
      const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);

      const lines = [];
      const lineStrings = [];

      for (const y of sortedY) {
        const lineItems = linesMap.get(y);
        // Sort items left-to-right by X
        lineItems.sort((a, b) => a.x - b.x);

        const lineText = lineItems.map((it) => it.str).join(' ').trim();
        if (lineText.length === 0) continue;

        const minX = Math.min(...lineItems.map((it) => it.x));
        const maxX = Math.max(...lineItems.map((it) => it.x + it.width));
        const minY = Math.min(...lineItems.map((it) => it.y));
        const maxY = Math.max(...lineItems.map((it) => it.y + it.height));

        // PDF coordinate conversion to standard image coordinate bbox:
        // [ [x1, y1], [x2, y1], [x2, y2], [x1, y2] ] where (0,0) is top-left
        const topY = viewport.height - maxY;
        const bottomY = viewport.height - minY;

        lines.push({
          text: lineText,
          confidence: 1.0, // Native text has 100% recognition confidence
          bbox: [
            [Math.round(minX), Math.round(topY)],
            [Math.round(maxX), Math.round(topY)],
            [Math.round(maxX), Math.round(bottomY)],
            [Math.round(minX), Math.round(bottomY)],
          ],
        });
        lineStrings.push(lineText);
      }

      const rawText = lineStrings.join('\n');
      const isUsable = this.isTextUsable(rawText, options);

      return {
        pageNumber,
        isUsable,
        rawText,
        lineCount: lines.length,
        lines,
        confidence: isUsable ? 1.0 : 0.0,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
      };
    } finally {
      await doc.destroy();
    }
  }
}

