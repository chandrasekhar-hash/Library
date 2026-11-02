import React from 'react';
import { UploadCloud, Palette, BookOpen, FileText } from 'lucide-react';
import WelcomeSection from '../components/WelcomeSection';
import ContinueReading from '../components/ContinueReading';
import QuickActionCard from '../components/QuickActionCard';
import RecentlyOpened from '../components/RecentlyOpened';
import QuickAccess from '../components/QuickAccess';

export default function Home({
  currentBook,
  recentlyOpenedBooks,
  onOpenBook,
  onOpenActionModal,
  customMedia,
  importedPdf,
  onTriggerImport,
  bookmarksCount = 0,
  highlightsCount = 0,
  notesCount = 0,
  totalBooksCount = 0,
}) {
  const quickActions = [
    {
      id: 'import',
      title: 'Import a Book',
      description: 'Open a PDF to read or save to your library.',
      icon: UploadCloud,
      accentColor: '#E7C18A',
      onClick: onTriggerImport,
      statusBadge: importedPdf ? `PDF: ${importedPdf.name}` : null,
    },
    {
      id: 'background',
      title: 'Background & Theme',
      description: 'Personalize sanctuary atmosphere & colors.',
      icon: Palette,
      accentColor: '#B886EE',
      onClick: () => onOpenActionModal('background'),
      statusBadge: customMedia ? 'Custom backdrop active' : null,
    },
    {
      id: 'library',
      title: 'My Library',
      description: 'View all saved books and progress.',
      icon: BookOpen,
      accentColor: '#67B8A2',
      onClick: () => onOpenActionModal('library'),
      statusBadge:
        totalBooksCount > 0
          ? `${totalBooksCount} ${totalBooksCount === 1 ? 'title' : 'titles'} catalogued`
          : 'No books yet',
    },
    {
      id: 'notes',
      title: 'My Notes',
      description: 'Your thoughts, highlights and ideas.',
      icon: FileText,
      accentColor: '#D99863',
      onClick: () => onOpenActionModal('notes'),
      statusBadge:
        notesCount > 0
          ? `${notesCount} active ${notesCount === 1 ? 'reflection' : 'reflections'}`
          : 'No reflections yet',
    },
  ];

  return (
    <div className="home-dashboard-immersive">
      <div className="home-page-container">
        {/* 1. Cinematic Welcome Banner & Dynamic Time Card */}
        <WelcomeSection />

      {/* 2. Primary Showcase: Continue Reading Card + Four Quick Actions */}
      <section className="primary-showcase-grid" aria-label="Reading overview and quick actions">
        <div className="continue-reading-col">
          <ContinueReading
            book={currentBook}
            onContinueReading={onOpenBook}
            onTriggerImport={onTriggerImport}
          />
        </div>

        <div className="quick-actions-col">
          <div className="quick-actions-grid">
            {quickActions.map((action) => (
              <QuickActionCard
                key={action.id}
                id={action.id}
                title={action.title}
                description={action.description}
                icon={action.icon}
                accentColor={action.accentColor}
                onClick={action.onClick}
                statusBadge={action.statusBadge}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 3. Secondary Row: Recently Opened Books + Quick Access shortcuts */}
      <section className="shelf-and-access-grid" aria-label="Recent books shelf and quick access">
        <div className="shelf-column">
          <RecentlyOpened
            books={recentlyOpenedBooks}
            onOpenBook={onOpenBook}
            onViewAllLibrary={() => onOpenActionModal('library')}
          />
        </div>

        <div className="access-column">
          <QuickAccess
            onOpenHighlights={() => onOpenActionModal('highlights')}
            onOpenBookmarks={() => onOpenActionModal('bookmarks')}
            onOpenNotes={() => onOpenActionModal('notes')}
            highlightsCount={highlightsCount}
            bookmarksCount={bookmarksCount}
            notesCount={notesCount}
          />
        </div>
      </section>
    </div>
  </div>
  );
}
