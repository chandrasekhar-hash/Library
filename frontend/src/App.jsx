import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Home from './pages/Home';
import Library from './pages/Library';
import CustomBackground from './components/CustomBackground';
import AksLoginPage from './components/auth/AksLoginPage';
import MigrationBanner from './components/migration/MigrationBanner';
import OwnerAccessBanner from './components/auth/OwnerAccessBanner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LibraryProvider, useLibrary } from './context/LibraryContext';

// Robust lazy loader with network retry capability
function lazyWithRetry(importFn) {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (err) {
      console.warn('[Aks CodeSplitting] Chunk fetch failed, retrying once...', err);
      await new Promise((r) => setTimeout(r, 800));
      return await importFn();
    }
  });
}

// ── Lazy-loaded secondary pages and heavy feature modals ───────────────────────
const ReaderPage = lazyWithRetry(() => import('./pages/ReaderPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));
const BookmarksPage = lazyWithRetry(() => import('./pages/BookmarksPage'));
const NotesPage = lazyWithRetry(() => import('./pages/NotesPage'));
const ImportPage = lazyWithRetry(() => import('./pages/ImportPage'));
const MigrationModal = lazyWithRetry(() => import('./components/migration/MigrationModal'));
const HighlightsModal = lazyWithRetry(() => import('./components/HighlightsModal'));
const BookActionModals = lazyWithRetry(() => import('./components/BookActionModals'));
const PlaceholderModal = lazyWithRetry(() => import('./components/PlaceholderModal'));
const ImportModal = lazyWithRetry(() => import('./components/ImportModal'));

function SanctuaryLoadingFallback({ message = 'Opening Sanctuary...' }) {
  return (
    <div className="sanctuary-lazy-fallback" role="status" aria-live="polite">
      <div className="sanctuary-lazy-spinner" />
      <span className="sanctuary-lazy-text">{message}</span>
    </div>
  );
}

import { MOODS } from './data/moods';
import { readingSession } from './services/sanctuaryDataService';
import { loadPreferences, subscribePreferences } from './services/preferencesService';
import { getCustomBackgroundMedia } from './services/mediaStorage';
import { applyTheme, DEFAULT_THEME } from './services/themeService';
import { CheckCircle2 } from 'lucide-react';
import './styles/import.css';
import './styles/reader.css';
import './styles/settings.css';

function AppContent({ toastMessage, showToast }) {
  const { currentUser, isGuest, login, logout, exploreAsGuest } = useAuth();
  const library = useLibrary();

  const initialPrefs = useMemo(() => loadPreferences(), []);

  const [activeNav, setActiveNav] = useState(() => {
    try {
      const stored = localStorage.getItem('aks_auth_user');
      if (stored) return 'home';
      const guest =
        localStorage.getItem('aks_guest_mode') === 'true' ||
        sessionStorage.getItem('aks_guest_mode') === 'true';
      return guest ? 'home' : 'login';
    } catch {
      return 'login';
    }
  });

  // Keep navigation in sync with authentication / guest state
  useEffect(() => {
    if (currentUser) {
      setActiveNav((prev) => (prev === 'login' ? 'home' : prev));
    } else if (!isGuest) {
      setActiveNav('login');
    }
  }, [currentUser, isGuest]);

  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [prevNav, setPrevNav] = useState('home');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Atmosphere preferences
  const [currentMoodId, setCurrentMoodId] = useState(
    () => initialPrefs?.global?.atmosphere?.currentMoodId || 'modern-dark'
  );
  const [backgroundMode, setBackgroundMode] = useState(
    () => initialPrefs?.global?.atmosphere?.backgroundMode || 'classic'
  );
  const [backgroundScope, setBackgroundScope] = useState(
    () => initialPrefs?.global?.atmosphere?.backgroundScope || 'all'
  );
  const [positioning, setPositioning] = useState(
    () => initialPrefs?.global?.atmosphere?.positioning || 'center'
  );
  const [backgroundIntensity, setBackgroundIntensity] = useState(
    () => initialPrefs?.global?.atmosphere?.backgroundIntensity || 'subtle'
  );
  const [backgroundDimming, setBackgroundDimming] = useState(
    () => initialPrefs?.global?.atmosphere?.backgroundDimming ?? 20
  );
  const [blurIntensity, setBlurIntensity] = useState(
    () => initialPrefs?.global?.atmosphere?.blurIntensity ?? 0
  );
  const [motionEnabled, setMotionEnabled] = useState(
    () => initialPrefs?.global?.atmosphere?.motionEnabled ?? true
  );
  const [customMedia, setCustomMedia] = useState(null);
  const [theme, setTheme] = useState(
    () => initialPrefs?.global?.theme || DEFAULT_THEME
  );

  const [activeModal, setActiveModal] = useState(null);
  const [selectedBookForReader, setSelectedBookForReader] = useState(null);
  const [activeBookAction, setActiveBookAction] = useState(null);

  const activeBlobUrlRef = React.useRef(null);

  // Load custom background media from IndexedDB on initial mount
  useEffect(() => {
    let isMounted = true;
    getCustomBackgroundMedia()
      .then((record) => {
        if (isMounted && record && record.blob) {
          if (activeBlobUrlRef.current) {
            URL.revokeObjectURL(activeBlobUrlRef.current);
          }
          const url = URL.createObjectURL(record.blob);
          activeBlobUrlRef.current = url;
          setCustomMedia({
            url,
            type: record.type,
            name: record.name,
            size: record.size,
            mimeType: record.mimeType,
          });
        }
      })
      .catch((err) => {
        console.warn('Could not load background media from IndexedDB:', err);
      });

    return () => {
      isMounted = false;
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  // Apply saved theme tokens on mount & when theme or backgroundMode changes
  useEffect(() => {
    applyTheme(theme, backgroundMode);
  }, [theme, backgroundMode]);

  // Sync theme class to <body>
  useEffect(() => {
    const classList = document.body.classList;
    MOODS.forEach((m) => classList.remove(`theme-${m.id}`));
    classList.add(`theme-${currentMoodId}`);
  }, [currentMoodId]);

  // Live subscribe to preference changes (Settings, Background, Theme)
  useEffect(() => {
    const unsubscribe = subscribePreferences((newPrefs) => {
      let activeMode = backgroundMode;
      let activeTheme = theme;

      if (newPrefs?.global?.atmosphere) {
        const atmo = newPrefs.global.atmosphere;
        if (atmo.backgroundMode) {
          setBackgroundMode(atmo.backgroundMode);
          activeMode = atmo.backgroundMode;
        }
        if (atmo.backgroundScope) setBackgroundScope(atmo.backgroundScope);
        if (atmo.positioning) setPositioning(atmo.positioning);
        if (atmo.currentMoodId) setCurrentMoodId(atmo.currentMoodId);
        if (atmo.backgroundIntensity) setBackgroundIntensity(atmo.backgroundIntensity);
        if (typeof atmo.backgroundDimming === 'number') setBackgroundDimming(atmo.backgroundDimming);
        if (typeof atmo.blurIntensity === 'number') setBlurIntensity(atmo.blurIntensity);
        if (typeof atmo.motionEnabled === 'boolean') setMotionEnabled(atmo.motionEnabled);
      }
      if (newPrefs?.global?.theme) {
        setTheme(newPrefs.global.theme);
        activeTheme = newPrefs.global.theme;
      }
      applyTheme(activeTheme, activeMode);
    });
    return unsubscribe;
  }, [backgroundMode, theme]);

  // Search results for TopBar
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return library.libraryBooks.filter(
      (book) =>
        book.title.toLowerCase().includes(query) ||
        (book.author && book.author.toLowerCase().includes(query)) ||
        (book.category && book.category.toLowerCase().includes(query)) ||
        (book.format && book.format.toLowerCase().includes(query))
    );
  }, [searchQuery, library.libraryBooks]);

  // Navigation click handler
  const handleNavClick = (navId) => {
    if (navId === 'home') {
      setActiveNav('home');
    } else if (navId === 'library') {
      setActiveNav('library');
    } else if (navId === 'import') {
      setActiveNav('import');
    } else if (navId === 'bookmarks') {
      setActiveNav('bookmarks');
    } else if (navId === 'notes') {
      setActiveNav('notes');
    } else if (navId === 'settings' || navId === 'mood') {
      setActiveNav('settings');
    } else if (navId === 'login') {
      setActiveNav('login');
    } else {
      setActiveModal(navId);
    }
  };

  // Open book in full-page Reading Room
  const handleOpenReader = (book, targetPage) => {
    setPrevNav(activeNav);
    const baseBook = book || library.currentBook;
    if (!baseBook) return;

    const bookToOpen = {
      ...baseBook,
      hasBeenOpened: true,
      lastOpened: 'Just now',
      lastOpenedTimestamp: Date.now(),
      ...(typeof targetPage === 'number' && targetPage > 0
        ? { currentPage: targetPage }
        : {}),
    };

    if (baseBook.id) {
      library.markBookOpened(baseBook.id, targetPage);
      readingSession.start(baseBook.id);
    }

    setSelectedBookForReader(bookToOpen);
    setActiveNav('reader');
  };

  const handleCloseReader = () => {
    if (selectedBookForReader?.id) {
      readingSession.finish(selectedBookForReader.id);
    }
    setSelectedBookForReader(null);
    setActiveNav(prevNav || 'library');
  };

  // Ensure active reading session finishes before window closes or refreshes
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (selectedBookForReader?.id) {
        readingSession.finish(selectedBookForReader.id);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [selectedBookForReader]);

  const handleSelectSearchResult = (book) => {
    setSearchQuery('');
    handleOpenReader(book);
  };

  const handleReadNowFromImport = (tempBook) => {
    setPrevNav(activeNav);
    setSelectedBookForReader(tempBook);
    setActiveNav('reader');
  };

  const handleUploadCustomMedia = (media) => {
    if (activeBlobUrlRef.current && activeBlobUrlRef.current !== media?.url) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
    }
    activeBlobUrlRef.current = media?.url || null;
    setCustomMedia(media);
    setBackgroundMode('custom');
  };

  const handleClearCustomMedia = () => {
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    setCustomMedia(null);
    setBackgroundMode('classic');
  };

  const handleSelectBackgroundMode = (mode) => {
    setBackgroundMode(mode);
    applyTheme(theme, mode);
  };

  const handleToggleIntensity = () => {
    setBackgroundIntensity((prev) => (prev === 'subtle' ? 'immersive' : 'subtle'));
  };

  // Reader: is the selected book saved in the library?
  const isReaderBookSaved = useMemo(() => {
    if (!selectedBookForReader || !library.libraryBooks) return false;
    return library.libraryBooks.some((b) => {
      if (b.id && b.id === selectedBookForReader.id) return true;
      if (b.sourceId && (b.sourceId === selectedBookForReader.id || b.sourceId === selectedBookForReader.sourceId)) return true;
      if (selectedBookForReader.sourceId && b.id === selectedBookForReader.sourceId) return true;
      const bHash = b.fileHash || b.file?.fileSha256;
      const rHash = selectedBookForReader.fileHash || selectedBookForReader.file?.fileSha256;
      if (bHash && rHash && bHash.toLowerCase() === rHash.toLowerCase()) return true;
      const bBytes = b.rawBytes || (b.file?.fileSizeBytes ? Number(b.file.fileSizeBytes) : null);
      const rBytes = selectedBookForReader.rawBytes || (selectedBookForReader.file?.fileSizeBytes ? Number(selectedBookForReader.file.fileSizeBytes) : null);
      const bName = (b.filename || b.file?.filename || '').toLowerCase();
      const rName = (selectedBookForReader.filename || selectedBookForReader.file?.filename || '').toLowerCase();
      if (bBytes && rBytes && bBytes === rBytes && bName && rName && bName === rName) return true;
      return false;
    });
  }, [library.libraryBooks, selectedBookForReader]);

  // Keep reader book synchronized with library books updates (covers, progress, bookmarks)
  const currentReaderBook = useMemo(() => {
    if (!selectedBookForReader) return null;
    const fromLibrary = library.libraryBooks?.find((b) => b.id === selectedBookForReader.id);
    return fromLibrary ? { ...selectedBookForReader, ...fromLibrary } : selectedBookForReader;
  }, [selectedBookForReader, library.libraryBooks]);

  return (
    <div className="app-layout-wrapper">
      {/* 1. Atmospheric Ambient or Custom Backdrop */}
      <CustomBackground
        backgroundMode={backgroundMode}
        backgroundScope={backgroundScope}
        positioning={positioning}
        customMedia={customMedia}
        backgroundIntensity={backgroundIntensity}
        backgroundDimming={backgroundDimming}
        blurIntensity={blurIntensity}
        motionEnabled={motionEnabled}
        activeNav={activeNav}
      />

      {/* 0. Aks Cinematic Video Intro & Book Login Page */}
      {activeNav === 'login' ? (
        <AksLoginPage
          onLoginSuccess={(user) => {
            login(user);
            setActiveNav('home');
            showToast(`Welcome to Aks, ${user.name || 'Reader'}!`);
          }}
          onExploreAsGuest={() => {
            exploreAsGuest();
            setActiveNav('home');
            showToast('Welcome to the Aks Reading Sanctuary.');
          }}
          onBackToSanctuary={currentUser ? () => setActiveNav('home') : null}
        />
      ) : activeNav === 'reader' && selectedBookForReader ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Suspense fallback={<SanctuaryLoadingFallback message="Entering Reading Room..." />}>
            <ReaderPage
              book={currentReaderBook}
              isSavedInLibrary={isReaderBookSaved}
              onBack={handleCloseReader}
              onUpdateBook={(updated) => {
                setSelectedBookForReader((prev) => (prev ? { ...prev, ...updated } : updated));
              }}
              onUpdateProgress={library.updateBookmark}
              onUpdateBookmarks={library.updateBookmarks}
              onUpdateHighlights={library.updateHighlights}
              onSaveUnsavedBook={async (bookToSave) => {
                const saved = await library.saveBookToLibrary(bookToSave);
                if (saved) {
                  setSelectedBookForReader(saved);
                }
                return saved;
              }}
            />
          </Suspense>
        </div>
      ) : (
        <>
          {/* 2. Left Sticky Sidebar & Mobile Drawer */}
          <Sidebar
            activeNav={activeNav}
            onNavClick={handleNavClick}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />

          {/* 3. Main Sanctuary Viewport */}
          <div className="app-main-viewport">
            <TopBar
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchResults={searchResults}
              onSelectSearchResult={handleSelectSearchResult}
              currentUser={currentUser}
              onOpenLogin={() => setActiveNav('login')}
            />

            {/* Guest Data Migration Notification Banner */}
            <MigrationBanner
              currentUser={currentUser}
              onOpenMigration={() => setIsMigrationModalOpen(true)}
            />

            {/* Owner-Authorized Account Access Persistent Banner */}
            <OwnerAccessBanner
              onExited={() => {
                showToast('Exited owner access. Returned to your Sanctuary.');
              }}
            />

            <main className="main-content-scroll" id="main-content">
              <Suspense fallback={<SanctuaryLoadingFallback />}>
                {activeNav === 'home' ? (
                  <Home
                    currentBook={library.currentBook}
                    recentlyOpenedBooks={library.recentlyOpenedBooks}
                    onOpenBook={handleOpenReader}
                    onOpenActionModal={(modalType) => {
                      if (modalType === 'library') {
                        setActiveNav('library');
                      } else if (modalType === 'bookmarks') {
                        setActiveNav('bookmarks');
                      } else if (modalType === 'notes') {
                        setActiveNav('notes');
                      } else if (modalType === 'mood' || modalType === 'background') {
                        setActiveNav('settings');
                      } else {
                        setActiveModal(modalType);
                      }
                    }}
                    customMedia={customMedia}
                    onTriggerImport={() => setActiveNav('import')}
                    bookmarksCount={library.totalBookmarksCount}
                    highlightsCount={library.totalHighlightsCount}
                    notesCount={library.totalNotesCount}
                    totalBooksCount={library.totalBooksCount}
                  />
                ) : activeNav === 'library' ? (
                  <Library
                    books={library.libraryBooks}
                    onOpenBook={handleOpenReader}
                    onTriggerImport={() => setActiveNav('import')}
                    onActionSelect={(action) => setActiveBookAction(action)}
                  />
                ) : activeNav === 'import' ? (
                  <ImportPage
                    books={library.libraryBooks}
                    onReadNow={handleReadNowFromImport}
                    onSaveToLibrary={library.saveBookToLibrary}
                    onNavigateTo={setActiveNav}
                    onOpenBook={handleOpenReader}
                  />
                ) : activeNav === 'bookmarks' ? (
                  <BookmarksPage
                    books={library.libraryBooks}
                    onOpenBook={handleOpenReader}
                    onNavigateTo={setActiveNav}
                    onUpdateBook={library.updateBook}
                  />
                ) : activeNav === 'notes' ? (
                  <NotesPage
                    books={library.libraryBooks}
                    onOpenBook={handleOpenReader}
                    onNavigateTo={setActiveNav}
                  />
                ) : activeNav === 'settings' ? (
                  <SettingsPage
                    books={library.libraryBooks}
                    onNavigateTo={setActiveNav}
                    currentMoodId={currentMoodId}
                    onSelectMood={setCurrentMoodId}
                    backgroundMode={backgroundMode}
                    onSelectBackgroundMode={handleSelectBackgroundMode}
                    backgroundScope={backgroundScope}
                    positioning={positioning}
                    backgroundIntensity={backgroundIntensity}
                    onToggleIntensity={handleToggleIntensity}
                    backgroundDimming={backgroundDimming}
                    blurIntensity={blurIntensity}
                    motionEnabled={motionEnabled}
                    customMedia={customMedia}
                    onUploadMedia={handleUploadCustomMedia}
                    onClearCustomMedia={handleClearCustomMedia}
                    currentUser={currentUser}
                    onLogout={async () => {
                      await logout();
                      setActiveNav('login');
                      showToast('You have been logged out of your sanctuary.');
                    }}
                    onOpenMigration={() => setIsMigrationModalOpen(true)}
                  />
                ) : null}
              </Suspense>
            </main>
          </div>

          {/* ── Modals and overlays (only when NOT in reader mode) ──────────────── */}
          <Suspense fallback={null}>
            {/* Import Modal */}
            {activeModal === 'import' && (
              <ImportModal
                isOpen={true}
                onClose={() => setActiveModal(null)}
                onReadNow={handleReadNowFromImport}
                onSaveToLibrary={library.saveBookToLibrary}
                books={library.libraryBooks}
                onOpenBook={handleOpenReader}
              />
            )}

            {/* Book Action Modals */}
            {activeBookAction && (
              <BookActionModals
                action={activeBookAction}
                onClose={() => setActiveBookAction(null)}
                onRenameBook={library.renameBook}
                onChangeCategory={library.changeCategory}
                onUpdateBookmark={library.updateBookmark}
                onRemoveBook={library.removeBook}
                onOpenReader={handleOpenReader}
              />
            )}

            {/* Highlights Modal */}
            {activeModal === 'highlights' && (
              <HighlightsModal
                isOpen={true}
                onClose={() => setActiveModal(null)}
                books={library.libraryBooks}
                onOpenBook={handleOpenReader}
                onDeleteHighlight={library.deleteHighlight}
              />
            )}

            {/* Migration Modal */}
            {isMigrationModalOpen && (
              <MigrationModal
                isOpen={true}
                onClose={() => setIsMigrationModalOpen(false)}
                currentUser={currentUser}
                onMigrationSuccess={(summary) => {
                  library.loadBooks();
                  showToast(
                    `Successfully migrated ${summary.migratedBooksCount} volume(s) into your library.`
                  );
                }}
              />
            )}

            {/* Feature Placeholders */}
            {activeModal &&
              activeModal !== 'import' &&
              activeModal !== 'highlights' && (
                <PlaceholderModal
                  type={activeModal}
                  books={library.libraryBooks}
                  onSelectBookToRead={handleOpenReader}
                  onClose={() => setActiveModal(null)}
                />
              )}
          </Suspense>

          {/* Toast */}
          {toastMessage && (
            <div className="library-toast-alert" role="status" aria-live="polite">
              <CheckCircle2 size={18} className="text-teal" />
              <span>{toastMessage}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = useCallback((message) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  return (
    <AuthProvider
      onSessionExpired={() =>
        showToast('Your session has expired. Please sign in again.')
      }
    >
      <LibraryProvider onNotify={showToast}>
        <AppContent toastMessage={toastMessage} showToast={showToast} />
      </LibraryProvider>
    </AuthProvider>
  );
}
