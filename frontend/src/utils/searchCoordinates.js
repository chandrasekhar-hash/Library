/**
 * searchCoordinates.js
 * Utilities for coordinate conversion and safe snippet parsing for Aks Reading Room search.
 *
 * Implements Phase OCR-3C coordinate mapping rules:
 * - OCR: 250 DPI raster image pixel coordinates mapped to percentage coordinates
 * - NATIVE: 72 DPI PDF point coordinates mapped to percentage coordinates
 * - Robust null handling: never invents coordinates when bbox is null
 * - Safe structured snippet parsing: decomposes <mark> tags into React-safe tokens
 */

/**
 * Convert raw bounding box coordinates to percentage coordinates relative to the page.
 *
 * @param {Array<Array<number>>|null} bbox - 4-point polygon [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
 * @param {'OCR'|'NATIVE'} source - Origin of the text recognition
 * @param {number} pageWidthPt - PDF page width in points (72 DPI)
 * @param {number} pageHeightPt - PDF page height in points (72 DPI)
 * @param {number} [rasterDpi=250] - Raster DPI used during OCR processing (default 250)
 * @param {number} [pageRotation=0] - Page rotation in degrees (0, 90, 180, 270)
 * @param {{ xOffset?: number, yOffset?: number }|null} [cropBoxOffset=null] - Optional CropBox origin offset
 * @returns {{ left: number, top: number, width: number, height: number }|null}
 */
export function convertSearchBboxToPercent(
  bbox,
  source,
  pageWidthPt,
  pageHeightPt,
  rasterDpi = 250,
  pageRotation = 0,
  cropBoxOffset = null
) {
  if (
    !Array.isArray(bbox) ||
    bbox.length < 4 ||
    !Number.isFinite(pageWidthPt) ||
    !Number.isFinite(pageHeightPt) ||
    pageWidthPt <= 0 ||
    pageHeightPt <= 0
  ) {
    return null;
  }

  // Validate points - all must be finite numbers
  const points = bbox.slice(0, 4);
  for (const pt of points) {
    if (
      !Array.isArray(pt) ||
      pt.length < 2 ||
      typeof pt[0] !== 'number' ||
      typeof pt[1] !== 'number' ||
      !Number.isFinite(pt[0]) ||
      !Number.isFinite(pt[1])
    ) {
      return null;
    }
  }

  // Apply optional CropBox origin offset if coordinates were relative to MediaBox
  const offsetX = cropBoxOffset?.xOffset || 0;
  const offsetY = cropBoxOffset?.yOffset || 0;

  const xs = points.map((p) => p[0] - offsetX);
  const ys = points.map((p) => p[1] - offsetY);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;

  if (rawWidth <= 0 || rawHeight <= 0) {
    return null;
  }

  // Account for unoriented dimensions if caller passed unrotated pt dimensions with rotation flag
  let effectiveWidthPt = pageWidthPt;
  let effectiveHeightPt = pageHeightPt;
  const normalizedRotation = ((pageRotation % 360) + 360) % 360;

  if (normalizedRotation === 90 || normalizedRotation === 270) {
    // If dimensions are portrait but rotation is 90/270, swap effective width & height
    if (pageWidthPt < pageHeightPt) {
      effectiveWidthPt = pageHeightPt;
      effectiveHeightPt = pageWidthPt;
    }
  }

  let baseWidth;
  let baseHeight;

  if (source === 'OCR') {
    // 250 DPI raster pixel coordinates
    const scaleFactor = (Number.isFinite(rasterDpi) && rasterDpi > 0 ? rasterDpi : 250) / 72;
    baseWidth = effectiveWidthPt * scaleFactor;
    baseHeight = effectiveHeightPt * scaleFactor;
  } else {
    // Native PDF 72 DPI point coordinates
    baseWidth = effectiveWidthPt;
    baseHeight = effectiveHeightPt;
  }

  if (baseWidth <= 0 || baseHeight <= 0 || !Number.isFinite(baseWidth) || !Number.isFinite(baseHeight)) {
    return null;
  }

  const left = (minX / baseWidth) * 100;
  const top = (minY / baseHeight) * 100;
  const width = (rawWidth / baseWidth) * 100;
  const height = (rawHeight / baseHeight) * 100;

  // Discard completely out-of-bounds bounding boxes
  if (left >= 100 || top >= 100 || left + width <= 0 || top + height <= 0) {
    return null;
  }

  // Robust boundary clamping to canvas bounds
  const clampedLeft = Math.max(0, Math.min(100, left));
  const clampedTop = Math.max(0, Math.min(100, top));
  const clampedWidth = Math.max(0, Math.min(100 - clampedLeft, width));
  const clampedHeight = Math.max(0, Math.min(100 - clampedTop, height));

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return {
    left: Math.round(clampedLeft * 100) / 100,
    top: Math.round(clampedTop * 100) / 100,
    width: Math.round(clampedWidth * 100) / 100,
    height: Math.round(clampedHeight * 100) / 100,
  };
}

/**
 * Enrich an array of search results with page-occurrence metadata so multiple
 * matches on the same page can be clearly distinguished in the UI.
 *
 * @param {Array<Object>} results
 * @returns {Array<Object>}
 */
export function distinguishPageMatches(results) {
  if (!Array.isArray(results) || results.length === 0) return [];

  const pageCounts = {};
  for (const r of results) {
    const page = r?.pageNumber;
    if (page !== undefined && page !== null) {
      pageCounts[page] = (pageCounts[page] || 0) + 1;
    }
  }

  const pageCurrentOcc = {};
  return results.map((r, idx) => {
    const page = r?.pageNumber;
    let matchOnPage = 1;
    let totalOnPage = 1;

    if (page !== undefined && page !== null) {
      pageCurrentOcc[page] = (pageCurrentOcc[page] || 0) + 1;
      matchOnPage = pageCurrentOcc[page];
      totalOnPage = pageCounts[page] || 1;
    }

    return {
      ...r,
      _resultIndex: idx,
      _matchOnPage: matchOnPage,
      _totalOnPage: totalOnPage,
    };
  });
}

/**
 * Decode basic HTML entities safely in text without innerHTML execution.
 *
 * @param {string} str
 * @returns {string}
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Parse an escaped snippet containing <mark> tags into a safe array of token segments.
 *
 * @param {string} highlightedSnippet - Escaped snippet with <mark>...</mark>
 * @param {string} [fallbackSnippet='']
 * @returns {Array<{ type: 'text'|'mark', text: string }>}
 */
export function parseSafeSnippetSegments(highlightedSnippet, fallbackSnippet = '') {
  const input = highlightedSnippet || fallbackSnippet || '';
  if (!input) return [];

  const segments = [];
  const markRegex = /<mark>(.*?)<\/mark>/gi;
  let lastIndex = 0;
  let match;

  while ((match = markRegex.exec(input)) !== null) {
    const textBefore = input.slice(lastIndex, match.index);
    if (textBefore.length > 0) {
      segments.push({
        type: 'text',
        text: decodeHtmlEntities(textBefore),
      });
    }

    const markedText = match[1];
    if (markedText.length > 0) {
      segments.push({
        type: 'mark',
        text: decodeHtmlEntities(markedText),
      });
    }

    lastIndex = markRegex.lastIndex;
  }

  const remaining = input.slice(lastIndex);
  if (remaining.length > 0) {
    segments.push({
      type: 'text',
      text: decodeHtmlEntities(remaining),
    });
  }

  return segments;
}

