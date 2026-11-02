/**
 * pdfService.js — PDF rendering & text-extraction service for Aks Reading Room
 * Uses pdfjs-dist (already installed). Worker configured once via module singleton.
 */
import * as pdfjsLib from 'pdfjs-dist';

// Ensure worker is configured (pdfParser.js may already have set this — that's fine,
// GlobalWorkerOptions is a singleton so the second assignment is a no-op).
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
} catch (e) {
  console.warn('[pdfService] Could not set workerSrc:', e);
}

/**
 * In-memory document cache configuration & tracking
 */
const MAX_CACHED_DOCUMENTS = 3;
const docCache = new Map(); // cacheKey -> { doc, lastUsed }
const inFlightLoads = new Map(); // cacheKey -> Promise<PDFDocumentProxy>
const activeDocs = new Set(); // Set of cacheKeys actively rendered/viewed in ReaderPage
const pendingEvictions = new Set(); // Set of cacheKeys queued for destruction once reader releases them
const destroyedDocs = new WeakSet(); // Guard against duplicate .destroy() calls

/**
 * Destroy a PDF.js document proxy safely and asynchronously.
 * Guarantees idempotency and catches any destruction errors.
 * @param {Object} pdfDoc
 * @returns {Promise<void>}
 */
export async function destroyPdfDocument(pdfDoc) {
  if (!pdfDoc || destroyedDocs.has(pdfDoc)) return;
  destroyedDocs.add(pdfDoc);

  if (typeof pdfDoc.destroy === 'function') {
    try {
      await pdfDoc.destroy();
    } catch (err) {
      console.warn('[pdfService] Non-fatal error during pdfDoc.destroy():', err?.message || err);
    }
  }
}

/**
 * Mark a document as currently in use by the Reader.
 * Protected from eviction while active.
 * @param {string} cacheKey
 */
export function markDocumentActive(cacheKey) {
  if (!cacheKey) return;
  activeDocs.add(cacheKey);
  pendingEvictions.delete(cacheKey);
  const entry = docCache.get(cacheKey);
  if (entry) {
    entry.lastUsed = Date.now();
  }
}

/**
 * Mark a document as no longer actively viewed in the Reader.
 * If an eviction was pending while active, evicts and destroys it now.
 * @param {string} cacheKey
 */
export function markDocumentInactive(cacheKey) {
  if (!cacheKey) return;
  activeDocs.delete(cacheKey);
  if (pendingEvictions.has(cacheKey)) {
    pendingEvictions.delete(cacheKey);
    evictPdfCache(cacheKey, { force: true });
  }
}

/**
 * Check whether a document is currently marked active.
 * @param {string} cacheKey
 * @returns {boolean}
 */
export function isDocumentActive(cacheKey) {
  return activeDocs.has(cacheKey);
}

/**
 * Check whether a document proxy has been destroyed.
 * @param {Object} pdfDoc
 * @returns {boolean}
 */
export function isDocumentDestroyed(pdfDoc) {
  return destroyedDocs.has(pdfDoc);
}

/**
 * Return count of currently cached PDF documents.
 * @returns {number}
 */
export function getCachedDocumentCount() {
  return docCache.size;
}

/**
 * Prune oldest inactive documents when cache capacity is exceeded.
 */
function pruneLruCache() {
  if (docCache.size <= MAX_CACHED_DOCUMENTS) return;

  // Find candidate for eviction: oldest lastUsed that is NOT active
  let oldestKey = null;
  let oldestTime = Infinity;

  for (const [key, entry] of docCache.entries()) {
    if (!activeDocs.has(key) && entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    evictPdfCache(oldestKey, { force: false });
  }
}

/**
 * Load a PDF from a Blob, ArrayBuffer, or URL.
 * Caches the result by cacheKey so subsequent pages load instantly.
 * Deduplicates in-flight loading tasks for the same cacheKey.
 */
export async function loadPdfDocument(source, cacheKey = null) {
  if (cacheKey && docCache.has(cacheKey)) {
    const entry = docCache.get(cacheKey);
    entry.lastUsed = Date.now();
    return entry.doc;
  }

  // Deduplicate concurrent in-flight loading tasks
  if (cacheKey && inFlightLoads.has(cacheKey)) {
    return inFlightLoads.get(cacheKey);
  }

  const loadPromise = (async () => {
    let data;
    let loadingTask;
    if (source instanceof Blob) {
      data = await source.arrayBuffer();
      loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        stopAtErrors: false,
      });
    } else if (source instanceof ArrayBuffer) {
      data = source;
      loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        stopAtErrors: false,
      });
    } else if (typeof source === 'string') {
      loadingTask = pdfjsLib.getDocument({
        url: source,
        withCredentials: true,
        useSystemFonts: true,
        stopAtErrors: false,
      });
    } else {
      throw new Error('Invalid PDF source — expected Blob, ArrayBuffer, or URL');
    }

    const pdfDoc = await loadingTask.promise;

    if (cacheKey) {
      // Ensure we stay within LRU capacity before caching
      pruneLruCache();
      docCache.set(cacheKey, { doc: pdfDoc, lastUsed: Date.now() });
      inFlightLoads.delete(cacheKey);
    }

    return pdfDoc;
  })();

  if (cacheKey) {
    inFlightLoads.set(cacheKey, loadPromise);
  }

  try {
    return await loadPromise;
  } finally {
    if (cacheKey) {
      inFlightLoads.delete(cacheKey);
    }
  }
}

/**
 * Remove and destroy a cached PDF document.
 * If force is false and the document is currently active, queues eviction for when it becomes inactive.
 * @param {string} cacheKey
 * @param {Object} [options]
 * @param {boolean} [options.force=false]
 * @returns {boolean} whether eviction was immediately executed
 */
export function evictPdfCache(cacheKey, { force = false } = {}) {
  if (!cacheKey || !docCache.has(cacheKey)) return false;

  // Active document protection: refuse destruction while active unless forced
  if (activeDocs.has(cacheKey) && !force) {
    pendingEvictions.add(cacheKey);
    return false;
  }

  const entry = docCache.get(cacheKey);
  docCache.delete(cacheKey);
  pendingEvictions.delete(cacheKey);
  activeDocs.delete(cacheKey);

  if (entry?.doc) {
    destroyPdfDocument(entry.doc);
  }

  return true;
}

/**
 * Transfer cache entry and active status from oldKey to newKey (e.g. when an unsaved preview book is saved).
 * @param {string} oldKey
 * @param {string} newKey
 */
export function rekeyPdfCache(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return;
  if (docCache.has(oldKey)) {
    const entry = docCache.get(oldKey);
    docCache.delete(oldKey);
    docCache.set(newKey, entry);
  }
  if (activeDocs.has(oldKey)) {
    activeDocs.delete(oldKey);
    activeDocs.add(newKey);
  }
  if (pendingEvictions.has(oldKey)) {
    pendingEvictions.delete(oldKey);
    pendingEvictions.add(newKey);
  }
}

/**
 * Clear and destroy all cached PDF documents (e.g. on full logout or cache reset).
 */
export function clearAllPdfCache() {
  for (const [key, entry] of docCache.entries()) {
    if (entry?.doc) {
      destroyPdfDocument(entry.doc);
    }
  }
  docCache.clear();
  inFlightLoads.clear();
  activeDocs.clear();
  pendingEvictions.clear();
  pageCanvasCache.clear();
  pageDimensionsCache.clear();
}

/**
 * In-memory page dimensions cache and rendered canvas cache for zero-flash page turns
 */
const pageDimensionsCache = new Map(); // `${docKey}_${pageNumber}` -> { width, height, rotation }
const pageCanvasCache = new Map(); // `${docKey}_${pageNumber}_${effectiveScale}` -> { canvas, logicalWidth, logicalHeight, width, height }

function getDocKey(pdfDoc) {
  if (!pdfDoc) return 'doc';
  return (
    pdfDoc.fingerprints?.[0] ||
    pdfDoc._pdfInfo?.fingerprint ||
    pdfDoc.id ||
    'doc'
  );
}

export function getCachedPageDimensions(pdfDoc, pageNumber) {
  if (!pdfDoc || !pageNumber) return null;
  const key = `${getDocKey(pdfDoc)}_${pageNumber}`;
  return pageDimensionsCache.get(key) || null;
}

export function setCachedPageDimensions(pdfDoc, pageNumber, dims) {
  if (!pdfDoc || !pageNumber || !dims) return;
  const key = `${getDocKey(pdfDoc)}_${pageNumber}`;
  pageDimensionsCache.set(key, {
    width: dims.width,
    height: dims.height,
    rotation: dims.rotation || 0,
  });
}

export function getCachedPageCanvas(pdfDoc, pageNumber, scale) {
  if (!pdfDoc || !pageNumber) return null;
  const key = `${getDocKey(pdfDoc)}_${pageNumber}_${Math.round((scale || 1.0) * 100)}`;
  return pageCanvasCache.get(key) || null;
}

export function setCachedPageCanvas(pdfDoc, pageNumber, scale, sourceCanvas, logicalWidth, logicalHeight) {
  if (!pdfDoc || !pageNumber || !sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;
  const key = `${getDocKey(pdfDoc)}_${pageNumber}_${Math.round((scale || 1.0) * 100)}`;

  try {
    let copy;
    if (typeof OffscreenCanvas !== 'undefined') {
      copy = new OffscreenCanvas(sourceCanvas.width, sourceCanvas.height);
    } else if (typeof document !== 'undefined' && document.createElement) {
      copy = document.createElement('canvas');
      copy.width = sourceCanvas.width;
      copy.height = sourceCanvas.height;
    } else {
      return;
    }
    const ctx = copy.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    // Limit cache size to 16 pages
    if (pageCanvasCache.size > 16) {
      const firstKey = pageCanvasCache.keys().next().value;
      pageCanvasCache.delete(firstKey);
    }

    pageCanvasCache.set(key, {
      canvas: copy,
      logicalWidth,
      logicalHeight,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
    });
  } catch (e) {
    // Non-fatal if offscreen canvas copy fails
  }
}

/**
 * Get unscaled dimensions and rotation for a page.
 */
export async function getPageDimensions(pdfDoc, pageNumber) {
  if (!pdfDoc || !pageNumber) return null;
  const cached = getCachedPageDimensions(pdfDoc, pageNumber);
  if (cached) return cached;
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const rotation = page.rotate || 0;
    const viewport = page.getViewport({ scale: 1.0, rotation });
    const result = {
      width: viewport.width,
      height: viewport.height,
      rotation,
      page,
    };
    setCachedPageDimensions(pdfDoc, pageNumber, result);
    return result;
  } catch (err) {
    console.warn('[pdfService] getPageDimensions error:', err);
    return null;
  }
}

/**
 * Render one PDF page onto a <canvas> element.
 * Honours devicePixelRatio for crisp rendering on HiDPI screens.
 * Returns the viewport and logical dimensions.
 */
export async function renderPageToCanvas(pdfDoc, pageNumber, canvas, scale = 1.5, onTaskCreated = null) {
  if (!pdfDoc || !canvas) return null;
  const page = await pdfDoc.getPage(pageNumber);
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const rotation = page.rotate || 0;
  const viewport = page.getViewport({ scale: scale * dpr, rotation });

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const logicalWidth = Math.round(viewport.width / dpr);
  const logicalHeight = Math.round(viewport.height / dpr);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({ canvasContext: ctx, viewport });
  if (typeof onTaskCreated === 'function') {
    onTaskCreated(renderTask);
  }
  await renderTask.promise;

  // Snapshot into pageCanvasCache for instant zero-flash page flipping
  setCachedPageCanvas(pdfDoc, pageNumber, scale, canvas, logicalWidth, logicalHeight);

  return { viewport, logicalWidth, logicalHeight, page };
}

/**
 * Render text layer for a PDF page into a container element.
 * Creates selectable text aligned with the canvas.
 * Disables selection during rendering and enables it upon completion.
 */
export async function renderTextLayer(pdfDoc, pageNumber, container, scale = 1.5, onTaskCreated = null) {
  if (!pdfDoc || !container) return null;
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const rotation = page.rotate || 0;
    const viewport = page.getViewport({ scale, rotation });

    container.innerHTML = '';
    const logicalW = Math.round(viewport.width);
    const logicalH = Math.round(viewport.height);
    container.style.width = `${logicalW}px`;
    container.style.height = `${logicalH}px`;
    container.style.setProperty('--scale-factor', `${scale}`);
    container.style.pointerEvents = 'none';

    const textContentSource = await page.getTextContent();
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource,
      container,
      viewport,
    });

    if (typeof onTaskCreated === 'function') {
      onTaskCreated(textLayer);
    }

    await textLayer.render();
    container.style.pointerEvents = 'auto';
    return { viewport, textLayer, logicalWidth: logicalW, logicalHeight: logicalH };
  } catch (err) {
    if (err?.name === 'RenderingCancelledException' || err?.name === 'AbortException') return null;
    console.warn('[pdfService] Text layer rendering error:', err);
    return null;
  }
}

/**
 * Extract plain text from a single page.
 * Returns empty string if the page has no text layer (scanned/image PDF).
 */
export async function extractPageText(pdfDoc, pageNumber) {
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str).join(' ');
  } catch {
    return '';
  }
}

/**
 * Search the full document for a query string.
 * Returns [{page, matchCount, preview}] sorted by page number.
 * NOTE: This is O(numPages) — for very large documents it may be slow.
 */
export async function searchDocument(pdfDoc, query, onProgress) {
  if (!query?.trim() || !pdfDoc) return [];
  const q = query.toLowerCase();
  const results = [];
  const total = pdfDoc.numPages;

  for (let i = 1; i <= total; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str).join(' ');
      const lower = text.toLowerCase();
      if (lower.includes(q)) {
        const matchCount = (lower.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        const idx = lower.indexOf(q);
        const start = Math.max(0, idx - 50);
        const end = Math.min(text.length, idx + q.length + 50);
        const preview =
          (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        results.push({ page: i, matchCount, preview });
      }
      if (onProgress) onProgress(i, total);
    } catch {
      // Skip unreadable pages
    }
  }
  return results;
}

/**
 * Render a high-quality cover thumbnail for a specific PDF page while preserving aspect ratio.
 * Can accept either an active PDFDocumentProxy or a File/Blob/URL.
 * 
 * @param {Object|File|Blob|string} pdfDocOrSource - Active PDF doc proxy or raw source
 * @param {number} [pageNumber=1] - Page number (1-based)
 * @param {Object} [options]
 * @param {number} [options.targetWidth=380] - Logical width in px for crisp cover display
 * @param {number} [options.quality=0.88] - JPEG quality
 * @returns {Promise<{ dataUrl: string, blob: Blob, width: number, height: number, aspectRatio: number, pageNumber: number }>}
 */
export async function renderPageThumbnail(pdfDocOrSource, pageNumber = 1, options = {}) {
  if (typeof document === 'undefined') {
    return {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      blob: null,
      width: 380,
      height: 550,
      aspectRatio: 380 / 550,
      pageNumber,
    };
  }

  let tempDoc = null;
  let doc = null;

  if (pdfDocOrSource && typeof pdfDocOrSource.getPage === 'function') {
    doc = pdfDocOrSource;
  } else if (pdfDocOrSource) {
    let sourceData = pdfDocOrSource;
    if (sourceData instanceof Blob) {
      sourceData = await sourceData.arrayBuffer();
    }
    const loadingTask = pdfjsLib.getDocument({
      data: sourceData,
      useSystemFonts: true,
      stopAtErrors: false,
    });
    tempDoc = await loadingTask.promise;
    doc = tempDoc;
  }

  if (!doc) {
    throw new Error('No PDF document available to render thumbnail.');
  }

  try {
    const clampedPage = Math.min(Math.max(1, pageNumber), doc.numPages || 1);
    const page = await doc.getPage(clampedPage);
    const rotation = page.rotate || 0;
    const unscaledViewport = page.getViewport({ scale: 1.0, rotation });

    const targetWidth = options.targetWidth || 380;
    const scale = Math.max(0.1, targetWidth / unscaledViewport.width);
    const viewport = page.getViewport({ scale, rotation });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');

    // Fill clean white background before rendering
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const quality = options.quality !== undefined ? options.quality : 0.88;
    const mimeType = 'image/jpeg';
    const dataUrl = canvas.toDataURL(mimeType, quality);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));

    return {
      dataUrl,
      blob,
      width: canvas.width,
      height: canvas.height,
      aspectRatio: canvas.width / canvas.height,
      pageNumber: clampedPage,
    };
  } finally {
    if (tempDoc) {
      try {
        await tempDoc.destroy();
      } catch (_) {}
    }
  }
}
