/**
 * In-memory per-book serialization lock.
 * Guarantees that concurrent file upload/replacements and book deletions for the same book execute
 * their storage placement, physical file cleanup, and database operations sequentially, preventing
 * race conditions, unreferenced orphan files, or deleting a book mid-upload.
 */
const bookLocks = new Map();

export async function withBookLock(bookId, fn) {
  const currentLock = bookLocks.get(bookId) || Promise.resolve();
  let releaseLock;
  const newLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  bookLocks.set(bookId, currentLock.then(() => newLock, () => newLock));

  try {
    await currentLock;
    return await fn();
  } finally {
    releaseLock();
    if (bookLocks.get(bookId) === newLock) {
      bookLocks.delete(bookId);
    }
  }
}
