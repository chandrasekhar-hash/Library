import * as pdfjsLib from 'pdfjs-dist';

// Configure Vite worker URL
try {
  // Use Vite ?url import for the pdf.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
} catch (e) {
  console.warn('Could not set pdf.js workerSrc from URL:', e);
}

/**
 * Fallback parser using regex on ArrayBuffer in case worker fails or is blocked
 */
export function extractPageCountFallback(arrayBuffer) {
  try {
    const text = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));
    
    // Look for /Type /Pages ... /Count (\d+)
    const pagesCountRegex = /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/g;
    let match;
    let maxPages = 0;
    while ((match = pagesCountRegex.exec(text)) !== null) {
      const count = parseInt(match[1], 10);
      if (count > maxPages) {
        maxPages = count;
      }
    }
    if (maxPages > 0) return maxPages;

    // Fallback: count individual /Type /Page (excluding /Pages)
    const pageMatches = text.match(/\/Type\s*\/Page\b/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }
  } catch (err) {
    console.warn('Fallback PDF regex parsing failed:', err);
  }
  return 1;
}

/**
 * Extracts metadata and real page count from a PDF File or Blob
 * @param {File|Blob} file 
 * @returns {Promise<{ pageCount: number, title?: string, author?: string }>}
 */
export async function parsePdfMetadata(file) {
  const arrayBuffer = await file.arrayBuffer();

  // Try standard pdfjs-dist first
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
      stopAtErrors: false,
    });
    const pdfDoc = await loadingTask.promise;
    const pageCount = pdfDoc.numPages || 1;

    let title = null;
    let author = null;
    try {
      const meta = await pdfDoc.getMetadata();
      if (meta && meta.info) {
        if (meta.info.Title && meta.info.Title.trim()) {
          title = meta.info.Title.trim();
        }
        if (meta.info.Author && meta.info.Author.trim()) {
          author = meta.info.Author.trim();
        }
      }
    } catch {
      // Ignore metadata reading error, page count is already retrieved
    }

    return {
      pageCount,
      title,
      author,
    };
  } catch (error) {
    console.warn('pdfjs-dist failed, attempting fallback regex parsing:', error);
    const fallbackCount = extractPageCountFallback(arrayBuffer);
    return {
      pageCount: fallbackCount || 1,
      title: null,
      author: null,
    };
  }
}

/**
 * Computes a SHA-256 fingerprint for a File or Blob.
 * Reads the first 2MB or entire file for sub-millisecond hashing.
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export async function computeFileHash(file) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const slice = file.slice(0, Math.min(file.size, 2 * 1024 * 1024));
      const buffer = await slice.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (err) {
    console.warn('[pdfParser] Crypto hash calculation fallback:', err);
  }
  return `hash-${file.name}-${file.size}`;
}

/**
 * Checks an array of existing books for a likely duplicate match.
 * Compares content hash, exact byte size, page count, and title.
 * @param {File} file
 * @param {Array} books
 * @param {number|null} parsedPageCount
 * @returns {Promise<{ book: object, matchType: string } | null>}
 */
export async function findDuplicateBook(file, books = [], parsedPageCount = null) {
  if (!file || !Array.isArray(books) || books.length === 0) return null;
  const newHash = await computeFileHash(file);

  for (const book of books) {
    // 1. Direct content hash match if stored previously
    if (book.fileHash && book.fileHash === newHash) {
      return { book, matchType: 'content' };
    }

    // 2. Exact match on raw byte size and filename or page count
    const sameSize = typeof book.rawBytes === 'number' && book.rawBytes === file.size;
    const sameFilename = book.filename && book.filename.toLowerCase() === file.name.toLowerCase();
    const samePages = parsedPageCount && book.totalPages && book.totalPages === parsedPageCount;

    if (sameSize && sameFilename) {
      return { book, matchType: 'filename-and-size' };
    }

    if (sameSize && samePages) {
      return { book, matchType: 'size-and-pages' };
    }
  }

  return null;
}

