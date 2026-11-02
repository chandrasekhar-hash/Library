import React from 'react';
import { Highlighter, Bookmark, FileText, ChevronRight, Sparkles } from 'lucide-react';

export default function QuickAccess({
  onOpenHighlights,
  onOpenBookmarks,
  onOpenNotes,
  highlightsCount = 0,
  bookmarksCount = 0,
  notesCount = 0,
}) {
  const formatBadge = (count, singular, plural = `${singular}s`) => {
    if (typeof count !== 'number' || count <= 0) return 'None yet';
    return `${count} ${count === 1 ? singular : plural}`;
  };

  const items = [
    {
      id: 'highlights',
      title: 'My Highlights',
      subtitle: 'See all highlighted text',
      icon: Highlighter,
      action: onOpenHighlights,
      countBadge: formatBadge(highlightsCount, 'saved passage', 'saved'),
    },
    {
      id: 'bookmarks',
      title: 'My Bookmarks',
      subtitle: 'Jump to saved pages',
      icon: Bookmark,
      action: onOpenBookmarks,
      countBadge: formatBadge(bookmarksCount, 'marker', 'markers'),
    },
    {
      id: 'notes',
      title: 'My Notes',
      subtitle: 'Recent notes and revision points',
      icon: FileText,
      action: onOpenNotes,
      countBadge: formatBadge(notesCount, 'entry', 'entries'),
    },
  ];

  return (
    <div className="quick-access-panel" aria-label="Quick Access Shortcuts">
      <div className="quick-access-header">
        <div className="qa-title-row">
          <Sparkles size={16} className="qa-sparkle" />
          <h3 className="quick-access-heading">Quick Access</h3>
        </div>
        <span className="quick-access-caption">Saved reading assets</span>
      </div>

      <div className="quick-access-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className="quick-access-row-btn"
              onClick={item.action}
            >
              <div className="qa-icon-halo">
                <Icon size={17} className="qa-icon" />
              </div>

              <div className="qa-text-col">
                <div className="qa-item-title-row">
                  <span className="qa-item-title">{item.title}</span>
                  <span className="qa-count-badge">{item.countBadge}</span>
                </div>
                <span className="qa-item-sub">{item.subtitle}</span>
              </div>

              <div className="qa-chevron-wrap">
                <ChevronRight size={17} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="quick-access-footer-tip">
        <p>Shortcuts sync with your current active reading books.</p>
      </div>
    </div>
  );
}
