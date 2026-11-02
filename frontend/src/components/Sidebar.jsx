import React from 'react';
import AksHindiWordmark from './brand/AksHindiWordmark';
import {
  Feather,
  Home,
  BookOpen,
  UploadCloud,
  Palette,
  Bookmark,
  FileText,
  Settings,
  X,
  Sparkles,
} from 'lucide-react';

export default function Sidebar({
  activeNav = 'home',
  onNavClick,
  isOpen = false,
  onClose,
}) {
  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'library', label: 'My Library', icon: BookOpen },
    { id: 'import', label: 'Import Book', icon: UploadCloud },
    { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
    { id: 'notes', label: 'My Notes', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleItemClick = (id) => {
    if (onNavClick) {
      onNavClick(id);
    }
    if (onClose) {
      onClose();
    }
  };

  return (
    <>
      {/* Mobile Backdrop overlay */}
      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar-container ${isOpen ? 'sidebar-open' : ''}`}>
        {/* Brand header */}
        <div className="sidebar-brand-wrapper">
          <div className="sidebar-brand" onClick={() => handleItemClick('home')} style={{ cursor: 'pointer' }}>
            <div className="brand-icon-halo">
              <Feather className="brand-feather-icon" size={20} />
            </div>
            <div className="brand-text-block">
              <h1 className="brand-wordmark">
                <AksHindiWordmark />
                <span className="brand-wordmark-dot" aria-hidden="true">·</span>
                <span className="brand-wordmark-english">Aks</span>
              </h1>
              <span className="brand-subtitle">A Reflection of You</span>
            </div>
          </div>

          {/* Close button on mobile */}
          <button
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close navigation sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Divider line */}
        <div className="sidebar-divider" />

        {/* Navigation list */}
        <nav className="sidebar-nav" aria-label="Main Navigation">
          <ul className="sidebar-nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;

              return (
                <li key={item.id} className="sidebar-nav-item">
                  <button
                    className={`sidebar-nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => handleItemClick(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="nav-icon-container">
                      <Icon size={18} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                    {isActive && <span className="active-glow-pill" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom decorative literary quote card */}
        <div className="sidebar-footer">
          <div className="sidebar-quote-card">
            <div className="quote-sparkle-row">
              <Sparkles size={13} className="quote-sparkle" />
              <span className="quote-tag">Reflections</span>
            </div>
            <p className="sidebar-quote-text">
              “A good book is a quiet place for a brighter mind.”
            </p>
            <div className="quote-footer-accent" />
          </div>
        </div>
      </aside>
    </>
  );
}
