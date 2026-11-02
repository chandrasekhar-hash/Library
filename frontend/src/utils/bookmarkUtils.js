/**
 * bookmarkUtils.js
 * Utility helpers for formatting and filtering bookmarks in Aks Reading Room.
 */

/**
 * Format creation timestamp gracefully:
 * e.g. "Bookmarked on 24 October" or "Bookmarked on 24 October 2025"
 */
export function formatBookmarkDate(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const isCurrentYear = d.getFullYear() === now.getFullYear();
    const day = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    const dateStr = isCurrentYear ? `${day} ${month}` : `${day} ${month} ${d.getFullYear()}`;
    return `Bookmarked on ${dateStr}`;
  } catch (_) {
    return null;
  }
}

/**
 * Format bookmark time: e.g. "4:30 PM"
 */
export function formatBookmarkTime(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (_) {
    return null;
  }
}

/**
 * Filter and sort bookmarks for a specific book volume
 */
export function filterBookBookmarks(bookmarks, bookId) {
  if (!Array.isArray(bookmarks)) return [];
  return bookmarks
    .filter((bm) => {
      if (!bm) return false;
      if (bm.bookId && bookId && String(bm.bookId) !== String(bookId)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (Number(a.page) || 0) - (Number(b.page) || 0));
}
