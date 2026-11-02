import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { initialLibraryBooks } from '../data/mockBooks';
import { restoreSampleBooks } from '../services/db';
import {
  fetchAllBooks,
  createNewBook,
  updateExistingBook,
  deleteExistingBook,
  saveReadingProgress,
  deleteExistingHighlight,
  fetchAllNotes,
  onDataChanged,
  updateBookCover as serviceUpdateBookCover,
  updateBookCoverPlacement as serviceUpdateBookCoverPlacement,
  resetBookCover as serviceResetBookCover,
} from '../services/sanctuaryDataService';
import { useAuth } from './AuthContext';

const LibraryContext = createContext(null);

export function LibraryProvider({ children, onNotify = null }) {
  const { currentUser } = useAuth();
  const [libraryBooks, setLibraryBooks] = useState(() => initialLibraryBooks);
  const [totalNotesCount, setTotalNotesCount] = useState(0);

  const loadBooks = useCallback(async () => {
    try {
      const storedBooks = await fetchAllBooks();
      setLibraryBooks(storedBooks || []);
    } catch (err) {
      console.warn('[LibraryContext] Could not load books:', err);
    }
  }, []);

  // Reload books whenever current user changes (e.g. login, logout, switch account)
  useEffect(() => {
    loadBooks();
  }, [currentUser, loadBooks]);

  // Listen to cross-component data changes
  useEffect(() => {
    const unsubscribe = onDataChanged((entity) => {
      if (entity === 'books') {
        loadBooks();
      }
    });
    return unsubscribe;
  }, [loadBooks]);

  // Derived current book for "Continue Reading"
  const currentBook = useMemo(() => {
    if (!libraryBooks || libraryBooks.length === 0) return null;
    const openedBooks = libraryBooks.filter(
      (b) => b.hasBeenOpened || (b.currentPage && b.currentPage > 0)
    );
    if (openedBooks.length > 0) {
      openedBooks.sort((a, b) => (b.lastOpenedTimestamp || 0) - (a.lastOpenedTimestamp || 0));
      return openedBooks[0];
    }
    return libraryBooks[0];
  }, [libraryBooks]);

  // Recently opened books for homepage
  const recentlyOpenedBooks = useMemo(() => {
    if (!libraryBooks || libraryBooks.length === 0) return [];
    return libraryBooks
      .filter(
        (b) =>
          (b.hasBeenOpened || (b.currentPage && b.currentPage > 0)) &&
          (!currentBook || b.id !== currentBook.id)
      )
      .sort((a, b) => (b.lastOpenedTimestamp || 0) - (a.lastOpenedTimestamp || 0))
      .slice(0, 4);
  }, [libraryBooks, currentBook]);

  // Derived dynamic counts
  const totalBookmarksCount = useMemo(() => {
    return libraryBooks.reduce(
      (acc, b) => acc + (b.bookmarks?.length || b.bookmarksCount || 0),
      0
    );
  }, [libraryBooks]);

  const totalHighlightsCount = useMemo(() => {
    return libraryBooks.reduce(
      (acc, b) => acc + (b.highlights?.length || b.highlightsCount || 0),
      0
    );
  }, [libraryBooks]);

  useEffect(() => {
    let isMounted = true;
    async function fetchNotesCount() {
      try {
        const notesList = await fetchAllNotes();
        const bookNotesSum = libraryBooks.reduce(
          (acc, b) => acc + (b.notes?.length || 0),
          0
        );
        const count = Math.max(notesList?.length || 0, bookNotesSum);
        if (isMounted) setTotalNotesCount(count);
      } catch (_) {
        if (isMounted) {
          const bookNotesSum = libraryBooks.reduce(
            (acc, b) => acc + (b.notes?.length || 0),
            0
          );
          setTotalNotesCount(bookNotesSum);
        }
      }
    }
    fetchNotesCount();
    return () => {
      isMounted = false;
    };
  }, [libraryBooks]);

  // Book modification handlers
  const renameBook = useCallback(
    async (bookId, newTitle) => {
      try {
        await updateExistingBook(bookId, { title: newTitle });
      } catch (err) {
        console.warn('[LibraryContext] Error updating title:', err);
      }
      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, title: newTitle } : b))
      );
      if (onNotify) onNotify(`Renamed volume to "${newTitle}"`);
    },
    [onNotify]
  );

  const changeCategory = useCallback(
    async (bookId, newCategory) => {
      try {
        await updateExistingBook(bookId, { category: newCategory });
      } catch (err) {
        console.warn('[LibraryContext] Error updating category:', err);
      }
      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, category: newCategory } : b))
      );
      if (onNotify) onNotify(`Category updated to "${newCategory}"`);
    },
    [onNotify]
  );

  const updateBookmark = useCallback(
    async (bookId, newPage) => {
      const updates = {
        currentPage: newPage,
        status: newPage > 0 ? 'in-progress' : 'not-started',
        lastOpened: 'Just now',
        lastOpenedTimestamp: Date.now(),
      };

      try {
        await saveReadingProgress(bookId, newPage);
      } catch (err) {
        console.warn('[LibraryContext] Error updating reading position:', err);
      }

      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, ...updates } : b))
      );
      if (onNotify) onNotify(`Bookmark updated to page ${newPage}`);
    },
    [onNotify]
  );

  const updateBookmarks = useCallback(async (bookId, updatedBookmarks) => {
    const updates = {
      bookmarks: updatedBookmarks,
      bookmarksCount: updatedBookmarks.length,
    };

    setLibraryBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, ...updates } : b))
    );

    try {
      await updateExistingBook(bookId, updates);
    } catch (err) {
      console.warn('[LibraryContext] Update bookmarks sync fallback:', err);
    }
  }, []);

  const updateBook = useCallback(
    async (bookId, updates) => {
      try {
        await updateExistingBook(bookId, updates);
      } catch (err) {
        console.warn('[LibraryContext] UpdateBook fallback to memory:', err);
      }
      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, ...updates } : b))
      );
      if (onNotify) onNotify('Bookmarks synchronized.');
    },
    [onNotify]
  );

  const removeBook = useCallback(
    async (bookId) => {
      const bookToRemove = libraryBooks.find((b) => b.id === bookId);
      try {
        await deleteExistingBook(bookId);
      } catch (err) {
        console.warn('[LibraryContext] Error deleting book:', err);
      }
      setLibraryBooks((prev) => prev.filter((b) => b.id !== bookId));
      if (onNotify) {
        onNotify(
          `"${bookToRemove ? bookToRemove.title : 'Book'}" removed from sanctuary shelf.`
        );
      }
    },
    [libraryBooks, onNotify]
  );

  const resetSampleBooks = useCallback(async () => {
    try {
      const restored = await restoreSampleBooks();
      setLibraryBooks(restored);
    } catch (err) {
      console.warn('[LibraryContext] Error restoring sample books in IndexedDB:', err);
      setLibraryBooks(initialLibraryBooks);
    }
    if (onNotify) onNotify('Restored default library collection.');
  }, [onNotify]);

  const saveBookToLibrary = useCallback(
    async (book) => {
      try {
        const savedBook = await createNewBook(book, book.blob || book.file);
        setLibraryBooks((prev) => [
          savedBook,
          ...prev.filter((b) => b.id !== savedBook.id && b.id !== book.id),
        ]);
        if (onNotify) {
          onNotify(`"${savedBook.title}" permanently saved to My Library.`);
        }
        return savedBook;
      } catch (err) {
        console.error('[LibraryContext] Failed to save to library:', err);
        if (onNotify) {
          onNotify(`Could not save book: ${err.message || 'Storage error'}`);
        }
        throw err;
      }
    },
    [onNotify]
  );

  const updateHighlights = useCallback((bookId, highlights) => {
    setLibraryBooks((prev) =>
      prev.map((b) =>
        b.id === bookId
          ? { ...b, highlights, highlightsCount: highlights.length }
          : b
      )
    );
  }, []);

  const deleteHighlight = useCallback(
    async (bookId, highlightId) => {
      try {
        await deleteExistingHighlight(bookId, highlightId);
        if (onNotify) onNotify('Highlight removed from library.');
      } catch (err) {
        console.warn('[LibraryContext] Could not delete highlight:', err);
      }
      setLibraryBooks((prev) =>
        prev.map((b) => {
          if (b.id !== bookId) return b;
          const updated = (b.highlights || []).filter((h) => h.id !== highlightId);
          return {
            ...b,
            highlights: updated,
            highlightsCount: updated.length,
          };
        })
      );
    },
    [onNotify]
  );

  const markBookOpened = useCallback((bookId, targetPage) => {
    const now = Date.now();
    const openedUpdates = {
      hasBeenOpened: true,
      lastOpened: 'Just now',
      lastOpenedTimestamp: now,
      ...(typeof targetPage === 'number' && targetPage > 0
        ? { currentPage: targetPage }
        : {}),
    };

    setLibraryBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, ...openedUpdates } : b))
    );
    updateExistingBook(bookId, openedUpdates).catch(() => {});
  }, []);

  const updateCover = useCallback(async (bookId, coverBlob, pageNumber, isCustom = true, placement = 'right') => {
    try {
      const updated = await serviceUpdateBookCover(bookId, coverBlob, pageNumber, isCustom, placement);
      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, ...updated } : b))
      );
      if (onNotify) {
        onNotify(isCustom ? `Custom cover set to page ${pageNumber} (${placement === 'left' ? 'Left Page' : 'Right Page'}).` : 'Book cover updated.');
      }
      return updated;
    } catch (err) {
      console.error('[LibraryContext] Failed to update cover:', err);
      if (onNotify) {
        onNotify(`Could not update cover: ${err.message || 'Error'}`);
      }
      throw err;
    }
  }, [onNotify]);

  const updateCoverPlacement = useCallback(async (bookId, placement) => {
    try {
      const updated = await serviceUpdateBookCoverPlacement(bookId, placement);
      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, ...updated } : b))
      );
      if (onNotify) {
        onNotify(`Cover placement set to ${placement === 'left' ? 'Left Page' : 'Right Page'}.`);
      }
      return updated;
    } catch (err) {
      console.error('[LibraryContext] Failed to update cover placement:', err);
      if (onNotify) {
        onNotify(`Could not update cover placement: ${err.message || 'Error'}`);
      }
      throw err;
    }
  }, [onNotify]);

  const resetCover = useCallback(async (bookId, defaultThumb = null) => {
    try {
      const updated = await serviceResetBookCover(bookId, defaultThumb);
      setLibraryBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, ...updated } : b))
      );
      if (onNotify) {
        onNotify('Restored original PDF cover.');
      }
      return updated;
    } catch (err) {
      console.error('[LibraryContext] Failed to reset cover:', err);
      if (onNotify) {
        onNotify(`Could not reset cover: ${err.message || 'Error'}`);
      }
      throw err;
    }
  }, [onNotify]);

  const value = useMemo(
    () => ({
      books: libraryBooks,
      libraryBooks,
      loadBooks,
      currentBook,
      recentlyOpenedBooks,
      totalBookmarksCount,
      totalHighlightsCount,
      totalNotesCount,
      totalBooksCount: libraryBooks.length,
      renameBook,
      changeCategory,
      updateBookmark,
      updateBookmarks,
      updateBook,
      removeBook,
      resetSampleBooks,
      saveBookToLibrary,
      updateHighlights,
      deleteHighlight,
      markBookOpened,
      updateCover,
      updateCoverPlacement,
      resetCover,
    }),
    [
      libraryBooks,
      loadBooks,
      currentBook,
      recentlyOpenedBooks,
      totalBookmarksCount,
      totalHighlightsCount,
      totalNotesCount,
      renameBook,
      changeCategory,
      updateBookmark,
      updateBookmarks,
      updateBook,
      removeBook,
      resetSampleBooks,
      saveBookToLibrary,
      updateHighlights,
      deleteHighlight,
      markBookOpened,
      updateCover,
      updateCoverPlacement,
      resetCover,
    ]
  );

  return (
    <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
}
