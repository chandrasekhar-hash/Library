/**
 * ReaderPage.jsx — Aks (अक्स) Reading Room (Page 4)
 *
 * Full-page immersive PDF reader with three reading modes:
 *  - PDF Mode: real canvas rendering via pdfjs-dist
 *  - Book Mode: two-page spread with CSS book styling
 *  - Focus Mode: extracted text in comfortable reading layout
 *
 * Features: page navigation, progress to IDB, bookmarks, notes, search, fullscreen.
 */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  AlertCircle,
  BookOpen,
  Loader2,
  BookmarkPlus,
  Library,
  Bookmark,
  BookmarkCheck,
  Feather,
  CheckCircle2,
  X,
  Info,
} from 'lucide-react';

import ReaderToolbar from '../components/reader/ReaderToolbar';
import ChangeCoverModal from '../components/reader/ChangeCoverModal';
import BookmarkHistoryModal from '../components/reader/BookmarkHistoryModal';
import PdfCanvas from '../components/reader/PdfCanvas';
import BookSpread from '../components/reader/BookSpread';
import FocusReader from '../components/reader/FocusReader';
import NotesDrawer from '../components/reader/NotesDrawer';
import DocumentSearch from '../components/reader/DocumentSearch';
import PdfContinuousViewer from '../components/reader/PdfContinuousViewer';
import PeacockBookmark from '../components/reader/PeacockBookmark';
import { useLibrary } from '../context/LibraryContext';
import {
  loadPdfDocument,
  evictPdfCache,
  markDocumentActive,
  markDocumentInactive,
  rekeyPdfCache,
  renderPageThumbnail,
} from '../services/pdfService';
import {
  fetchBookDetails,
  saveReadingProgress,
  addBookBookmark,
  removeBookBookmark,
  addBookHighlight,
  removeBookHighlight,
  saveNewNote,
  updateExistingNote,
  deleteExistingNote,
  updateExistingBook,
} from '../services/sanctuaryDataService';
import { getSpreadIndexForPage, getSpreadForIndex } from '../utils/bookDimensions';
import {
  getEffectivePreferences,
  syncBookOverridesFromServer,
  updateGlobalCategory,
  subscribePreferences,
} from '../services/preferencesService';
import { preloadPageTurnSound } from '../services/soundService';
import { useStudyTimer } from '../services/studyTimeService';

// Debounce helper
function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

export default function ReaderPage({
  book,
  isSavedInLibrary,
  onBack,
  onSaveUnsavedBook,
  onUpdateBook,
  onUpdateProgress,
  onUpdateBookmarks,
  onUpdateHighlights,
}) {
  // ── Library & Cover Management ──────────────────────────────────────────
  const library = useLibrary();
  const updateCover = library?.updateCover;
  const updateCoverPlacement = library?.updateCoverPlacement;
  const resetCover = library?.resetCover;

  // ── UI panels & search state ───────────────────────────────────────────────
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchMatch, setActiveSearchMatch] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [localBook, setLocalBook] = useState(book);
  const [prevBook, setPrevBook] = useState(book);
  if (book !== prevBook) {
    setPrevBook(book);
    setLocalBook(book);
    // Only reset search and highlights when actually switching to a different volume
    if (book?.id !== prevBook?.id) {
      setActiveSearchMatch(null);
      setSearchResults([]);
      setSearchOpen(false);
    }
  }

  const [changeCoverOpen, setChangeCoverOpen] = useState(false);
  const [bookmarkHistoryOpen, setBookmarkHistoryOpen] = useState(false);

  // ── Effective preferences (Global merged with Book Overrides) ──────────────
  const [prefVersion, setPrefVersion] = useState(0);
  useEffect(() => {
    return subscribePreferences(() => {
      setPrefVersion((v) => v + 1);
    });
  }, []);

  const effectivePrefs = useMemo(
    () => getEffectivePreferences(localBook?.id || book?.id),
    [localBook?.id, book?.id, prefVersion]
  );

  // ── Preload realistic page-turning sound for 0-latency physical playback ──
  useEffect(() => {
    preloadPageTurnSound().catch(() => {});
  }, []);

  const isPageTurnSoundEnabled = effectivePrefs?.reading?.pageTurnSound !== false;

  const handleTogglePageTurnSound = useCallback(() => {
    const nextVal = !isPageTurnSoundEnabled;
    updateGlobalCategory('reading', { pageTurnSound: nextVal });
  }, [isPageTurnSoundEnabled]);

  // ── PDF loading state ──────────────────────────────────────────────────────
  const [pdfDoc, setPdfDoc] = useState(null);
  const [loadState, setLoadState] = useState('idle'); // idle | loading | ready | error | no-blob
  const [loadError, setLoadError] = useState('');
  const [prevBookForLoad, setPrevBookForLoad] = useState(book);

  if (book !== prevBookForLoad) {
    setPrevBookForLoad(book);
    if (!book) {
      setLoadState('idle');
      setPdfDoc(null);
    }
  }

  // ── Persistent Study Time Tracking (Active Reading Only) ─────────────────
  useStudyTimer({
    isReading: Boolean(book && (loadState === 'ready' || loadState === 'no-blob')),
  });

  // ── Reader state ───────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(() =>
    Math.max(1, book?.currentPage || 1)
  );
  // Actual total pages takes pdfDoc.numPages if available, falling back to book.totalPages
  const totalPages = Math.max(1, pdfDoc?.numPages || book?.totalPages || 1);
  const [mode, setMode] = useState(() => {
    try {
      const stored = localStorage.getItem('aks_reader_mode') || localStorage.getItem('folio_reader_mode');
      if (stored) return stored;
    } catch (_) {}
    return effectivePrefs?.reading?.defaultMode || 'book';
  });

  const handleModeChange = useCallback((newMode) => {
    setMode(newMode);
    try {
      localStorage.setItem('aks_reader_mode', newMode);
      localStorage.setItem('folio_reader_mode', newMode);
    } catch (_) {}
  }, []);

  const [scale, setScale] = useState(1.5);

  // ── Bookmarks, Notes & Highlights (from book record) ───────────────────────
  const [bookmarks, setBookmarks] = useState(() => book?.bookmarks || []);
  const [prevBookBookmarks, setPrevBookBookmarks] = useState(book?.bookmarks);
  if (book?.bookmarks !== prevBookBookmarks) {
    setPrevBookBookmarks(book?.bookmarks);
    if (Array.isArray(book?.bookmarks)) {
      setBookmarks(book.bookmarks);
    }
  }

  const [notes, setNotes] = useState(() => book?.notes || []);

  const [highlights, setHighlights] = useState(() => book?.highlights || []);
  const [prevBookHighlights, setPrevBookHighlights] = useState(book?.highlights);
  if (book?.highlights !== prevBookHighlights) {
    setPrevBookHighlights(book?.highlights);
    if (Array.isArray(book?.highlights)) {
      setHighlights(book.highlights);
    }
  }

  // ── Unsaved book prompt & feedback toast ───────────────────────────────────
  const [isSaved, setIsSaved] = useState(isSavedInLibrary);
  const [prevIsSavedInLibrary, setPrevIsSavedInLibrary] = useState(isSavedInLibrary);
  if (isSavedInLibrary !== prevIsSavedInLibrary) {
    setPrevIsSavedInLibrary(isSavedInLibrary);
    setIsSaved(isSavedInLibrary);
  }
  const [isSaving, setIsSaving] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [readerToast, setReaderToast] = useState(null);

  useEffect(() => {
    if (!readerToast) return;
    const t = setTimeout(() => setReaderToast(null), 3500);
    return () => clearTimeout(t);
  }, [readerToast]);

  // ── Physical Peacock Bookmark Animation & Closing State ──────────────────
  // State machine: OPEN → CLOSING (animation in flight) → CLOSED (resting on cover)
  const [isClosingBook, setIsClosingBook] = useState(false);   // animation in flight
  const [isBookClosed, setIsBookClosed] = useState(false);     // resting on closed cover
  const [isBookmarkClosing, setIsBookmarkClosing] = useState(false);
  const [bookmarkClosingState, setBookmarkClosingState] = useState(null); // { active: bool, stage: 'emerge'|'to-center'|'closing'|'closed', page: number }
  const [retractingBookmarkPage, setRetractingBookmarkPage] = useState(null);
  const [flyingBookmarkPage, setFlyingBookmarkPage] = useState(null);
  const bookmarkAnimTimersRef = useRef([]);

  const handleFlightComplete = useCallback(() => {
    setFlyingBookmarkPage(null);
  }, []);

  const clearBookmarkAnimTimers = useCallback(() => {
    bookmarkAnimTimersRef.current.forEach(clearTimeout);
    bookmarkAnimTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearBookmarkAnimTimers();
  }, [clearBookmarkAnimTimers]);

  // Automatically generate Page 1 cover thumbnail in background if missing
  useEffect(() => {
    if (!pdfDoc || !localBook?.id) return;
    if (localBook.coverUrl || localBook.coverImage) return;

    let cancelled = false;
    async function autoGenerateDefaultCover() {
      try {
        const thumb = await renderPageThumbnail(pdfDoc, 1, { targetWidth: 400, quality: 0.92 });
        if (cancelled || !thumb) return;
        if (updateCover) {
          const updated = await updateCover(localBook.id, thumb.blob || thumb.dataUrl, 1, false);
          if (!cancelled && updated) {
            setLocalBook((prev) => ({ ...prev, ...updated }));
          }
        }
      } catch (err) {
        console.warn('[ReaderPage] Could not auto-generate default cover:', err);
      }
    }
    autoGenerateDefaultCover();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, localBook?.id, localBook?.coverUrl, localBook?.coverImage, updateCover]);

  const handleUpdateCover = useCallback(
    async (bookId, coverBlob, pageNumber, isCustom = true, placement = 'right') => {
      if (updateCover) {
        const updated = await updateCover(bookId, coverBlob, pageNumber, isCustom, placement);
        if (updated) {
          setLocalBook((prev) => ({ ...prev, ...updated }));
          if (onUpdateBook) onUpdateBook(updated);
        }
        return updated;
      }
    },
    [updateCover, onUpdateBook]
  );

  const handleUpdateCoverPlacement = useCallback(
    async (bookId, placement) => {
      if (updateCoverPlacement) {
        const updated = await updateCoverPlacement(bookId, placement);
        const resolvedBook = {
          ...(updated || {}),
          coverPlacement: placement,
          coverTheme: {
            ...((updated || {}).coverTheme || (localBook || book)?.coverTheme || {}),
            coverPlacement: placement,
          },
        };
        setLocalBook((prev) => ({ ...prev, ...resolvedBook }));
        if (onUpdateBook) onUpdateBook(resolvedBook);
        return resolvedBook;
      }
    },
    [updateCoverPlacement, onUpdateBook]
  );

  const handleResetCover = useCallback(
    async (bookId, defaultThumb = null) => {
      if (resetCover) {
        const updated = await resetCover(bookId, defaultThumb);
        if (updated) {
          setLocalBook((prev) => ({ ...prev, ...updated }));
          if (onUpdateBook) onUpdateBook(updated);
        }
        return updated;
      }
    },
    [resetCover, onUpdateBook]
  );

  const readerRef = useRef(null);
  const activeObjectUrlRef = useRef(null);
  const bookSpreadRef = useRef(null);
  const loadedBookIdRef = useRef(null);
  const loadedBlobSourceRef = useRef(null);

  // Derive sample book state
  const isSampleBook = loadState === 'no-blob' || (!book?.blob && !pdfDoc);

  // ── Progress persistence (debounced) ───────────────────────────────────────
  // Defined first to ensure no TDZ errors in downstream handlers
  const debouncedSaveProgress = useMemo(
    () =>
      debounce(async (bookId, page) => {
        if (!bookId || !isSaved) return;
        try {
          await saveReadingProgress(bookId, page);
          if (onUpdateProgress) onUpdateProgress(bookId, page);
        } catch (err) {
          console.warn('[ReaderPage] Progress save failed:', err);
        }
      }, 800),
    [isSaved, onUpdateProgress]
  );

  // ── Page change ────────────────────────────────────────────────────────────
  const handlePageChange = useCallback(
    (newPage, shouldSave = true, source = 'manual') => {
      const clamped = Math.max(1, Math.min(totalPages, newPage));
      setCurrentPage(clamped);
      if (source === 'manual' && activeSearchMatch && Number(activeSearchMatch.pageNumber) !== Number(clamped)) {
        setActiveSearchMatch(null);
      }
      if (shouldSave && book?.id && isSaved) debouncedSaveProgress(book.id, clamped);
    },
    [totalPages, book?.id, isSaved, debouncedSaveProgress, activeSearchMatch]
  );

  // ── Toolbar & Keyboard Animated Page Turn Handlers ────────────────────────
  const handleToolbarPrev = useCallback(() => {
    if (mode === 'book' && bookSpreadRef.current?.triggerPrev) {
      bookSpreadRef.current.triggerPrev();
    } else {
      handlePageChange(currentPage - 1);
    }
  }, [mode, currentPage, handlePageChange]);

  const handleToolbarNext = useCallback(() => {
    if (mode === 'book' && bookSpreadRef.current?.triggerNext) {
      bookSpreadRef.current.triggerNext();
    } else {
      handlePageChange(currentPage + 1);
    }
  }, [mode, currentPage, handlePageChange]);

  // ── Fullscreen toggle ──────────────────────────────────────────────────────
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      readerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // ── Bookmark current page ──────────────────────────────────────────────────
  const isCurrentPageBookmarked = useMemo(() => {
    if (!Array.isArray(bookmarks) || bookmarks.length === 0) return false;
    return bookmarks.some((bm) => bm.page === currentPage);
  }, [bookmarks, currentPage]);

  // ── Realistic Physical Book Closing Handler (Triggered only by Close Book) ─
  // State machine: OPEN → CLOSING (animation) → CLOSED (resting on cover until Back)
  const handleCloseBook = useCallback(() => {
    if (isClosingBook || isBookClosed) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReducedMotion || effectivePrefs?.reading?.pageTurnAnimation === false) {
      // Skip animation: jump straight to CLOSED state
      setIsBookClosed(true);
      return;
    }

    // OPEN → CLOSING
    setIsClosingBook(true);
    const timer = setTimeout(() => {
      // CLOSING → CLOSED (animation done; stay on closed cover)
      setIsClosingBook(false);
      setIsBookClosed(true);
    }, 1350);
    bookmarkAnimTimersRef.current.push(timer);
  }, [isClosingBook, isBookClosed, effectivePrefs]);

  const handleToggleBookmark = useCallback(async () => {
    if (isClosingBook || flyingBookmarkPage || retractingBookmarkPage) return;

    if (!isSaved) {
      // Unsaved document workflow: do not silently drop, prompt user to save to library
      setShowUnsavedModal(true);
      return;
    }

    const previousBookmarks = [...bookmarks];
    const bmToRemove = bookmarks.find((bm) => bm.page === currentPage);
    const isCurrentlyBookmarked = !!bmToRemove;
    let updated;

    try {
      if (isCurrentlyBookmarked) {
        // ── Bookmark Removal Workflow ────────────────────────────────────────
        const targetRemovePage = bmToRemove.page;
        setRetractingBookmarkPage(targetRemovePage);

        await removeBookBookmark(book.id, bmToRemove.id);

        // Wait for reverse flight animation to complete before removing from state
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 640);
          bookmarkAnimTimersRef.current.push(timer);
        });

        updated = bookmarks.filter((bm) => bm.id !== bmToRemove.id);

        setBookmarks(updated);
        setRetractingBookmarkPage(null);
        if (onUpdateBookmarks) {
          onUpdateBookmarks(book.id, updated);
        }

        setReaderToast({
          type: 'success',
          message: `Bookmark removed from page ${targetRemovePage}.`,
        });
      } else {
        // ── Bookmark Creation Workflow ────────────────────────────────────────
        // Immediate persistence (PostgreSQL / IndexedDB)
        const created = await addBookBookmark(book.id, {
          page: currentPage,
          label: `Page ${currentPage}`,
          color: 'gold',
        });
        updated = [...bookmarks, created];

        setBookmarks(updated);
        setFlyingBookmarkPage(currentPage);
        if (onUpdateBookmarks) {
          onUpdateBookmarks(book.id, updated);
        }

        setReaderToast({
          type: 'success',
          message: `Page ${currentPage} bookmarked.`,
        });
      }
    } catch (err) {
      console.error('[ReaderPage] Bookmark save failed:', err);
      setRetractingBookmarkPage(null);
      setFlyingBookmarkPage(null);
      setBookmarks(previousBookmarks);
      setReaderToast({
        type: 'error',
        message: `Could not save bookmark: ${err?.message || 'Storage error'}`,
      });
    }
  }, [
    bookmarks,
    currentPage,
    book?.id,
    isSaved,
    isClosingBook,
    flyingBookmarkPage,
    retractingBookmarkPage,
    onUpdateBookmarks,
  ]);

  const handleRemoveBookmark = useCallback(
    async (bm) => {
      if (!bm?.id || !book?.id || isBookmarkClosing || retractingBookmarkPage || flyingBookmarkPage) return;
      try {
        setRetractingBookmarkPage(bm.page);
        await removeBookBookmark(book.id, bm.id);

        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 640);
          bookmarkAnimTimersRef.current.push(timer);
        });

        const updated = bookmarks.filter((b) => b.id !== bm.id);
        setBookmarks(updated);
        setRetractingBookmarkPage(null);
        if (onUpdateBookmarks) {
          onUpdateBookmarks(book.id, updated);
        }
        setReaderToast({
          type: 'success',
          message: `Bookmark removed from page ${bm.page}.`,
        });
      } catch (err) {
        console.error('[ReaderPage] Failed to remove bookmark:', err);
        setRetractingBookmarkPage(null);
      }
    },
    [book?.id, bookmarks, isBookmarkClosing, retractingBookmarkPage, flyingBookmarkPage, onUpdateBookmarks]
  );

  // ── Unsaved Modal Handlers ─────────────────────────────────────────────────
  const handleSaveAndBookmark = async () => {
    if (isSaving || !onSaveUnsavedBook || !book) return;
    setIsSaving(true);
    setSavingPrompt(true);
    try {
      const newBm = {
        id: `bm-${book.id}-p${currentPage}-${Date.now()}`,
        bookId: book.id,
        page: currentPage,
        label: `Page ${currentPage}`,
        createdAt: new Date().toISOString(),
        color: 'gold',
      };
      const updatedBookmarks = [...bookmarks, newBm];

      const savedBook = await onSaveUnsavedBook({
        ...book,
        currentPage,
        bookmarks: updatedBookmarks,
        bookmarksCount: updatedBookmarks.length,
        notes,
        highlights,
        highlightsCount: highlights.length,
      });

      setIsSaved(true);
      setBookmarks(updatedBookmarks);
      setShowUnsavedModal(false);

      if (onUpdateBookmarks) {
        onUpdateBookmarks(savedBook?.id || book.id, updatedBookmarks);
      }
      if (onUpdateHighlights) {
        onUpdateHighlights(savedBook?.id || book.id, highlights);
      }

      setReaderToast({
        type: 'success',
        message: `Page ${currentPage} bookmarked.`,
      });
      // Bookmarking does NOT automatically close the book. Stays open.
    } catch (err) {
      console.error('[ReaderPage] Save & bookmark failed:', err);
      setReaderToast({
        type: 'error',
        message: `Could not save document: ${err?.message || 'Storage error'}. Please try again.`,
      });
    } finally {
      setIsSaving(false);
      setSavingPrompt(false);
    }
  };

  const handleCreateTemporaryBookmark = () => {
    const isCurrentlyBookmarked = bookmarks.some((bm) => bm.page === currentPage);
    let updated;
    if (isCurrentlyBookmarked) {
      updated = bookmarks.filter((bm) => bm.page !== currentPage);
      setReaderToast({
        type: 'info',
        message: `Removed temporary bookmark from page ${currentPage}.`,
      });
    } else {
      const tempBm = {
        id: `bm-temp-p${currentPage}-${Date.now()}`,
        page: currentPage,
        label: `Page ${currentPage} (Temporary)`,
        createdAt: new Date().toISOString(),
        color: 'gold',
        isTemporary: true,
      };
      updated = [...bookmarks, tempBm];
      setReaderToast({
        type: 'warning',
        message: `Temporary bookmark added for page ${currentPage} (will not persist outside this session).`,
      });
    }
    setBookmarks(updated);
    setShowUnsavedModal(false);
  };

  // ── Save notes ────────────────────────────────────────────────────────────
  const handleSaveNotes = useCallback(
    async (updatedNotes, noteOp) => {
      const activeBook = localBook || book;
      const activeBookId = activeBook?.id;

      if (noteOp?.type === 'add' && noteOp?.note) {
        // Save note through data service (PostgreSQL for authenticated users, IndexedDB for guest)
        const saved = await saveNewNote({
          ...noteOp.note,
          bookId: activeBookId || null,
          bookTitle: activeBook?.title || null,
        });

        const finalNote = saved && saved.id ? saved : noteOp.note;
        setNotes((prev) => {
          const updated = [
            finalNote,
            ...prev.filter((n) => n.id !== noteOp.note.id && n.id !== finalNote.id),
          ];
          if (onUpdateBook) {
            onUpdateBook({ notes: updated });
          }
          return updated;
        });

        return finalNote;
      }

      if (noteOp?.type === 'update' && noteOp?.note) {
        const saved = await updateExistingNote(noteOp.note.id, noteOp.note);
        const finalNote = saved && saved.id ? saved : noteOp.note;
        setNotes((prev) => {
          const updated = prev.map((n) => (n.id === finalNote.id ? finalNote : n));
          if (onUpdateBook) {
            onUpdateBook({ notes: updated });
          }
          return updated;
        });
        return finalNote;
      }

      if (noteOp?.type === 'delete' && noteOp?.noteId) {
        await deleteExistingNote(noteOp.noteId);
        setNotes((prev) => {
          const updated = prev.filter((n) => n.id !== noteOp.noteId);
          if (onUpdateBook) {
            onUpdateBook({ notes: updated });
          }
          return updated;
        });
        return true;
      }

      setNotes(updatedNotes);
      if (onUpdateBook) {
        onUpdateBook({ notes: updatedNotes });
      }
    },
    [localBook, book, onUpdateBook]
  );

  // ── Highlights Management ──────────────────────────────────────────────────
  const handleAddHighlight = useCallback(
    async (newHighlight) => {
      // Optimistically add to local state
      setHighlights((prev) => {
        const filtered = prev.filter((h) => h.id !== newHighlight.id);
        return [...filtered, newHighlight];
      });

      if (book?.id && isSaved) {
        try {
          const res = await addBookHighlight(book.id, newHighlight);
          if (res) {
            setHighlights((prev) => {
              const updated = prev.map((h) => (h.id === newHighlight.id ? res : h));
              if (onUpdateHighlights) onUpdateHighlights(book.id, updated);
              return updated;
            });
          }
          setReaderToast({
            type: 'success',
            message: `Passage highlighted on page ${newHighlight.page}.`,
          });
        } catch (err) {
          console.error('[ReaderPage] Could not persist highlight:', err);
          setReaderToast({
            type: 'error',
            message: 'Failed to save highlight to library storage.',
          });
        }
      } else {
        setReaderToast({
          type: 'info',
          message: `Highlighted on page ${newHighlight.page} (save book to preserve).`,
        });
      }
    },
    [book?.id, isSaved, onUpdateHighlights]
  );

  const handleDeleteHighlight = useCallback(
    async (highlightId) => {
      // Optimistically remove from local state
      setHighlights((prev) => {
        const remaining = prev.filter((h) => h.id !== highlightId);
        if (onUpdateHighlights && book?.id) onUpdateHighlights(book.id, remaining);
        return remaining;
      });

      if (book?.id && isSaved) {
        try {
          await removeBookHighlight(book.id, highlightId);
          setReaderToast({
            type: 'info',
            message: 'Highlight removed.',
          });
        } catch (err) {
          console.error('[ReaderPage] Could not delete highlight:', err);
          setReaderToast({
            type: 'error',
            message: 'Failed to remove highlight from storage.',
          });
        }
      } else {
        setReaderToast({
          type: 'info',
          message: 'Highlight removed.',
        });
      }
    },
    [book?.id, isSaved, onUpdateHighlights]
  );

  // ── Save unsaved book (toolbar button & inline banner button) ─────────────
  const handleSaveToLibrary = async () => {
    if (isSaving || isSaved || !onSaveUnsavedBook || !book) return;
    setIsSaving(true);
    setSavingPrompt(true);
    try {
      const permanentBookmarks = bookmarks.map((bm) => ({
        ...bm,
        id: bm.id && bm.id.startsWith('bm-temp') ? `bm-${book.id}-p${bm.page}-${Date.now()}` : bm.id,
        bookId: book.id,
        isTemporary: undefined,
        label: bm.label ? bm.label.replace(' (Temporary)', '') : `Page ${bm.page}`,
      }));

      const savedBook = await onSaveUnsavedBook({
        ...book,
        currentPage,
        bookmarks: permanentBookmarks,
        bookmarksCount: permanentBookmarks.length,
        notes,
        highlights,
        highlightsCount: highlights.length,
      });

      if (savedBook?.id && book?.id && savedBook.id !== book.id) {
        rekeyPdfCache(book.id, savedBook.id);
        loadedBookIdRef.current = savedBook.id;
      }

      setIsSaved(true);
      setBookmarks(permanentBookmarks);
      setShowUnsavedModal(false);

      if (onUpdateBookmarks) {
        onUpdateBookmarks(savedBook?.id || book.id, permanentBookmarks);
      }
      if (onUpdateHighlights) {
        onUpdateHighlights(savedBook?.id || book.id, highlights);
      }

      setReaderToast({
        type: 'success',
        message: `Saved "${book.title || 'Book'}" to your library.`,
      });
    } catch (err) {
      console.error('[ReaderPage] Save failed:', err);
      setIsSaved(false);
      setReaderToast({
        type: 'error',
        message: `Could not save to library: ${err?.message || 'Storage error'}. Please try again.`,
      });
    } finally {
      setIsSaving(false);
      setSavingPrompt(false);
    }
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // Registered after handleToolbarPrev/Next and handleToggleFullscreen are defined
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen((v) => {
          if (v) setActiveSearchMatch(null);
          return !v;
        });
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handleToolbarPrev();
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        handleToolbarNext();
      }
      if (!e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
        handleToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleToolbarPrev, handleToolbarNext, handleToggleFullscreen]);

  // ── Fullscreen change listener ─────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Load PDF document (handles unsaved session files and saved IDB books) ───
  useEffect(() => {
    let cancelled = false;

    // Clean up previous object URL if any
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }

    if (!book) {
      return;
    }

    async function initDocument() {
      let blobSource = book.fileUrl || book.blob;
      let targetPage = book.currentPage || 1;

      // If document is already loaded for this same source, keep active and do not reload
      if (pdfDoc && loadedBlobSourceRef.current && loadedBlobSourceRef.current === blobSource) {
        if (book.id) {
          if (loadedBookIdRef.current && loadedBookIdRef.current !== book.id) {
            rekeyPdfCache(loadedBookIdRef.current, book.id);
          }
          loadedBookIdRef.current = book.id;
          markDocumentActive(book.id);
          setIsSaved(true);
        }
        return;
      }

      setLoadState('loading');
      setPdfDoc(null);
      setLoadError('');

      // If the book has an ID, retrieve the latest canonical data (blob/url, bookmarks, notes, highlights)
      if (book.id) {
        try {
          const [details] = await Promise.all([
            fetchBookDetails(book.id),
            syncBookOverridesFromServer(book.id).catch(() => null),
          ]);
          if (details) {
            setIsSaved(true);
            if (details.fileUrl) {
              blobSource = details.fileUrl;
            } else if (details.blob) {
              blobSource = details.blob;
            }
            // Prioritize explicitly requested page (e.g. from bookmark jump), otherwise use DB position
            if (typeof book.currentPage === 'number' && book.currentPage > 0) {
              targetPage = book.currentPage;
            } else if (typeof details.currentPage === 'number' && details.currentPage > 0) {
              targetPage = details.currentPage;
            }
            if (Array.isArray(details.bookmarks)) {
              setBookmarks(details.bookmarks);
            }
            if (Array.isArray(details.notes)) {
              setNotes(details.notes);
            }
            if (Array.isArray(details.highlights)) {
              setHighlights(details.highlights);
            }
          }
        } catch (dbErr) {
          console.warn('[ReaderPage] Could not retrieve book details:', dbErr);
        }
      }

      if (cancelled) return;

      if (!blobSource) {
        // Curated sample collection book with no actual PDF
        setLoadState('no-blob');
        setCurrentPage(Math.max(1, targetPage));
        return;
      }

      // Track active object URL for session cleanup if needed
      if (blobSource instanceof Blob && !blobSource.objectUrl) {
        try {
          const url = URL.createObjectURL(blobSource);
          activeObjectUrlRef.current = url;
        } catch (_) {}
      }

      setCurrentPage(Math.max(1, targetPage));

      try {
        const cacheKey = book.id || null;
        const doc = await loadPdfDocument(blobSource, cacheKey);
        if (!cancelled) {
          if (cacheKey) markDocumentActive(cacheKey);
          loadedBookIdRef.current = book.id;
          loadedBlobSourceRef.current = blobSource;
          setPdfDoc(doc);
          setLoadState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[ReaderPage] PDF load error:', err);
          setLoadError(
            err?.message?.includes('Invalid PDF')
              ? 'This file does not appear to be a valid PDF document.'
              : `Failed to load PDF: ${err?.message || 'Unknown error'}`
          );
          setLoadState('error');
        }
      }
    }

    initDocument();

    return () => {
      cancelled = true;
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, [book, book?.id, book?.blob, book?.fileUrl, book?.currentPage, isSavedInLibrary]);

  // Evict cache and revoke object URL when reader unmounts
  const currentBookIdRef = useRef(book?.id);
  useEffect(() => {
    currentBookIdRef.current = book?.id;
  }, [book?.id]);

  useEffect(() => {
    return () => {
      const finalId = currentBookIdRef.current;
      if (finalId) {
        markDocumentInactive(finalId);
        evictPdfCache(finalId, { force: true });
      }
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
      loadedBlobSourceRef.current = null;
    };
  }, []);

  const progress = Math.round((currentPage / totalPages) * 100);

  // ── Early-out guards ───────────────────────────────────────────────────────
  if (!book) {
    return (
      <div className="rdr-error-page">
        <AlertCircle size={32} />
        <h3>No document selected.</h3>
        <button className="btn-primary" onClick={onBack}>Return to Library</button>
      </div>
    );
  }

  const activeMoodThemeClass = effectivePrefs?.atmosphere?.currentMoodId
    ? `theme-${effectivePrefs.atmosphere.currentMoodId}`
    : '';

  return (
    <div
      ref={readerRef}
      className={`reader-page ${activeMoodThemeClass} ${notesOpen ? 'reader-page--notes-open' : ''} ${isFullscreen ? 'reader-page--fullscreen' : ''}`}
      aria-label="Reading Room"
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <ReaderToolbar
        book={localBook || book}
        currentPage={currentPage}
        totalPages={totalPages}
        mode={mode}
        isBookmarked={isCurrentPageBookmarked}
        isFullscreen={isFullscreen}
        scale={scale}
        notesOpen={notesOpen}
        searchOpen={searchOpen}
        isSaved={isSaved}
        isSaving={isSaving || savingPrompt}
        isBookmarkDisabled={isClosingBook}
        onSaveToLibrary={handleSaveToLibrary}
        onOpenChangeCover={() => setChangeCoverOpen(true)}
        onOpenBookmarkHistory={() => setBookmarkHistoryOpen(true)}
        pageTurnSound={isPageTurnSoundEnabled}
        onTogglePageTurnSound={handleTogglePageTurnSound}
        onBack={onBack}
        onPageChange={handlePageChange}
        onPrev={handleToolbarPrev}
        onNext={handleToolbarNext}
        onModeChange={handleModeChange}
        onToggleBookmark={handleToggleBookmark}
        onToggleNotes={() => setNotesOpen((v) => !v)}
        onToggleSearch={() => setSearchOpen((v) => !v)}
        onToggleFullscreen={handleToggleFullscreen}
        onScaleChange={setScale}
      />

      {/* ── Search panel (below toolbar) ─────────────────────────────────────── */}
      <DocumentSearch
        pdfDoc={pdfDoc}
        book={localBook || book}
        isSaved={isSaved}
        isOpen={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          setActiveSearchMatch(null);
          setSearchResults([]);
        }}
        onJumpToPage={handlePageChange}
        onSelectSearchMatch={setActiveSearchMatch}
        activeSearchMatch={activeSearchMatch}
        onSearchResultsChange={setSearchResults}
      />

      {/* ── Main body: reading surface + notes drawer ─────────────────────────── */}
      <div className="reader-body">
        {/* ── Reading surface ────────────────────────────────────────────────── */}
        <main className="reader-surface" aria-label="Reading surface">
          {/* Unsaved prompt banner */}
          {!isSaved && (
            <div className="rdr-unsaved-banner" role="status">
              <BookOpen size={14} />
              <span>
                You're reading without saving. Your progress won't persist after you leave.
              </span>
              <button
                className="rdr-save-inline-btn"
                onClick={handleSaveToLibrary}
                disabled={savingPrompt}
              >
                {savingPrompt ? (
                  <><Loader2 size={13} className="rdr-spin" /> Saving…</>
                ) : (
                  <><BookmarkPlus size={13} /> Save to Library</>
                )}
              </button>
            </div>
          )}

          {/* ── Loading state ─────────────────────────────────────────────────── */}
          {loadState === 'loading' && (
            <div className="rdr-loading-screen" aria-busy="true" aria-label="Loading PDF">
              <div className="rdr-loading-book">
                <Loader2 size={38} className="rdr-spin rdr-loading-icon" />
              </div>
              <p className="rdr-loading-label">Preparing your reading room…</p>
              <p className="rdr-loading-sub">{book.title}</p>
            </div>
          )}

          {/* ── Error state ───────────────────────────────────────────────────── */}
          {loadState === 'error' && (
            <div className="rdr-error-screen" role="alert">
              <AlertCircle size={36} className="rdr-error-icon" />
              <h3>Could not open this document</h3>
              <p className="rdr-error-detail">{loadError}</p>
              <div className="rdr-error-actions">
                <button className="btn-secondary" onClick={onBack}>
                  <Library size={15} /> Back to Library
                </button>
              </div>
            </div>
          )}

          {/* ── PDF Mode (Continuous natural scrolling) ────────────────────── */}
          {(loadState === 'ready' || loadState === 'no-blob') && mode === 'pdf' && (
            <div className="rdr-pdf-mode-area">
              <PdfContinuousViewer
                pdfDoc={loadState === 'ready' ? pdfDoc : null}
                totalPages={totalPages}
                scale={scale}
                currentPage={currentPage}
                onPageChange={handlePageChange}
                isSampleBook={isSampleBook}
                book={book}
                highlights={highlights}
                onAddHighlight={handleAddHighlight}
                onDeleteHighlight={handleDeleteHighlight}
                bookId={book?.id}
                preferredHighlightColor={effectivePrefs?.annotations?.defaultHighlightColor || 'gold'}
                activeSearchMatch={searchOpen ? activeSearchMatch : null}
                allSearchMatches={searchOpen ? searchResults : []}
                onSelectSearchMatch={setActiveSearchMatch}
              />
            </div>
          )}

          {/* ── Book Mode (Physical book layout with natural scroll & 3D turn) ─ */}
          {(loadState === 'ready' || loadState === 'no-blob') && mode === 'book' && (
            <div className="rdr-book-mode-area">
              <BookSpread
                ref={bookSpreadRef}
                pdfDoc={loadState === 'ready' ? pdfDoc : null}
                currentPage={currentPage}
                totalPages={totalPages}
                scale={1.0}
                isSampleBook={isSampleBook}
                onPageChange={handlePageChange}
                animationEnabled={effectivePrefs?.reading?.pageTurnAnimation !== false}
                animationSpeed={effectivePrefs?.reading?.animationSpeed || 'normal'}
                pageTurnSoundEnabled={isPageTurnSoundEnabled}
                highlights={highlights}
                onAddHighlight={handleAddHighlight}
                onDeleteHighlight={handleDeleteHighlight}
                bookId={book?.id}
                book={localBook || book}
                preferredHighlightColor={effectivePrefs?.annotations?.defaultHighlightColor || 'gold'}
                bookmarks={bookmarks}
                activeSearchMatch={searchOpen ? activeSearchMatch : null}
                allSearchMatches={searchOpen ? searchResults : []}
                onSelectSearchMatch={setActiveSearchMatch}
                isClosingBook={isClosingBook}
                isBookClosed={isBookClosed}
                onCloseBook={!isBookClosed ? handleCloseBook : null}
                bookmarkClosingState={bookmarkClosingState}
                retractingBookmarkPage={retractingBookmarkPage}
                flyingBookmarkPage={flyingBookmarkPage}
                onFlightComplete={handleFlightComplete}
                onRemoveBookmark={handleRemoveBookmark}
                onBack={isBookClosed ? onBack : null}
              />
            </div>
          )}

          {/* ── Focus Mode (Continuous comfortable typography) ───────────────── */}
          {(loadState === 'ready' || loadState === 'no-blob') && mode === 'focus' && (
            <FocusReader
              pdfDoc={loadState === 'ready' ? pdfDoc : null}
              currentPage={currentPage}
              totalPages={totalPages}
              isSampleBook={isSampleBook}
              onPageChange={handlePageChange}
              typographyPrefs={effectivePrefs?.typography}
            />
          )}

          {/* ── Closing Overlay for Continuous PDF & Focus Modes ────────────── */}
          {isBookmarkClosing && (mode === 'pdf' || mode === 'focus') && (
            <div className="rdr-mode-closing-overlay" aria-hidden="true">
              <div className="fixed-book-frame fixed-book-frame--closing">
                <div className="book-page book-page--left book-page--closing-left">
                  <div className="book-closing-shadow book-closing-shadow--left" />
                </div>
                <div className="book-spine">
                  <div className="book-spine-center-stitch" />
                </div>
                <div className="book-page book-page--right book-page--closing-right">
                  <div className="book-closing-shadow book-closing-shadow--right" />
                </div>
                <div className="book-closing-center-spine-bookmark">
                  <PeacockBookmark
                    page={currentPage}
                    side="center"
                    state={bookmarkClosingState?.stage === 'to-center' ? 'to-center' : 'closing'}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Bookmarks list (sidebar strip) ────────────────────────────────── */}
          {bookmarks.length > 0 && (
            <div className="rdr-bookmarks-strip" aria-label="Your bookmarks">
              {bookmarks.map((bm) => (
                <button
                  key={bm.page}
                  className={`rdr-bm-chip ${bm.page === currentPage ? 'rdr-bm-chip--active' : ''}`}
                  onClick={() => handlePageChange(bm.page)}
                  title={`Jump to page ${bm.page}`}
                  aria-label={`Bookmark: page ${bm.page}`}
                >
                  {bm.page}
                </button>
              ))}
            </div>
          )}
        </main>

        {/* ── Notes Drawer ─────────────────────────────────────────────────── */}
        <NotesDrawer
          isOpen={notesOpen}
          notes={notes}
          currentPage={currentPage}
          bookTitle={(localBook || book)?.title || 'Untitled'}
          bookId={(localBook || book)?.id}
          onClose={() => setNotesOpen(false)}
          onSaveNotes={handleSaveNotes}
        />
      </div>

      {/* ── Unsaved Document Bookmark Prompt Modal ──────────────────────────── */}
      {showUnsavedModal && (
        <div className="rdr-modal-backdrop" onClick={() => setShowUnsavedModal(false)}>
          <div
            className="rdr-save-prompt-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rdr-save-prompt-title"
          >
            <div className="rdr-save-prompt-icon-wrap">
              <Feather size={26} className="text-gold" />
            </div>

            <h3 id="rdr-save-prompt-title" className="rdr-save-prompt-title">
              Save Document to Create Bookmark
            </h3>

            <p className="rdr-save-prompt-desc">
              You are currently reading an unsaved document (<em>{book.title}</em>).
              To ensure your bookmarks are saved to <strong>My Bookmarks</strong> and remain
              after you close this window, save this book to your sanctuary library.
            </p>

            <div className="rdr-save-prompt-actions">
              <button
                className="btn-primary rdr-save-confirm-btn"
                onClick={handleSaveAndBookmark}
                disabled={savingPrompt}
              >
                {savingPrompt ? (
                  <><Loader2 size={15} className="rdr-spin" /> Saving to Library…</>
                ) : (
                  <><BookmarkPlus size={15} /> Save to Library & Bookmark Page {currentPage}</>
                )}
              </button>

              <button
                className="btn-secondary rdr-temp-bm-btn"
                onClick={handleCreateTemporaryBookmark}
                disabled={savingPrompt}
              >
                <Bookmark size={14} /> Keep Temporary (Session Only)
              </button>

              <button
                className="btn-ghost rdr-cancel-btn"
                onClick={() => setShowUnsavedModal(false)}
                disabled={savingPrompt}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Book Cover Modal ────────────────────────────────────── */}
      <ChangeCoverModal
        isOpen={changeCoverOpen}
        onClose={() => setChangeCoverOpen(false)}
        book={localBook || book}
        currentPage={currentPage}
        pdfDoc={pdfDoc}
        onUpdateCover={handleUpdateCover}
        onUpdateCoverPlacement={handleUpdateCoverPlacement}
        onResetCover={handleResetCover}
      />

      {/* ── Bookmark History Modal ────────────────────────────────────── */}
      <BookmarkHistoryModal
        isOpen={bookmarkHistoryOpen}
        onClose={() => setBookmarkHistoryOpen(false)}
        bookmarks={bookmarks}
        book={localBook || book}
        currentPage={currentPage}
        onNavigateToPage={(targetPage) => {
          handlePageChange(targetPage);
          setBookmarkHistoryOpen(false);
        }}
        onRemoveBookmark={handleRemoveBookmark}
      />

      {/* ── In-reader Toast Alert ────────────────────────────────────────────── */}
      {readerToast && (
        <div
          className={`rdr-toast-alert rdr-toast-alert--${readerToast.type || 'info'}`}
          role="status"
          aria-live="polite"
        >
          {readerToast.type === 'error' ? (
            <AlertCircle size={16} className="text-amber" />
          ) : readerToast.type === 'warning' ? (
            <Info size={16} className="text-gold" />
          ) : (
            <CheckCircle2 size={16} className="text-teal" />
          )}
          <span>{readerToast.message}</span>
          <button
            className="rdr-toast-close-btn"
            onClick={() => setReaderToast(null)}
            aria-label="Dismiss message"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sample book placeholder (no real PDF) ──────────────────────────────────
function SampleBookPlaceholder({ book, currentPage, totalPages }) {
  return (
    <div className="rdr-sample-placeholder">
      <div className="rdr-sample-paper">
        <div className="rdr-sample-header">
          <span className="rdr-sample-title">{book.title}</span>
          <span className="rdr-sample-pages">Page {currentPage} of {totalPages}</span>
        </div>

        <div className="rdr-sample-notice">
          <BookOpen size={22} className="rdr-sample-notice-icon" />
          <p>
            <strong>Sample collection entry</strong> — this volume is part of the curated
            Aks demonstration library. Import a real PDF via{' '}
            <em>Import Book</em> to see your actual document content rendered here.
          </p>
        </div>

        <div className="rdr-sample-content-lines">
          {[...Array(24)].map((_, i) => (
            <div
              key={i}
              className="rdr-sample-line"
              style={{
                width: `${55 + ((i * 13 + 7) % 43)}%`,
                opacity: 0.3 + ((i % 4) * 0.1),
              }}
            />
          ))}
        </div>

        <div className="rdr-sample-footer">
          <span>Aks Digital Sanctuary Edition</span>
          <span>p. {currentPage}</span>
        </div>
      </div>
    </div>
  );
}
