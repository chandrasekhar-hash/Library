import React, { useState } from 'react';
import { Search, Bell, Menu, X, BookOpen } from 'lucide-react';

export default function TopBar({
  onToggleSidebar,
  searchQuery = '',
  onSearchChange,
  searchResults = [],
  onSelectSearchResult,
  unreadCount = 0,
  currentUser = null,
  onOpenLogin,
}) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = [
    {
      id: 1,
      title: 'Reading Sanctuary Ready',
      desc: 'Your peaceful reading space is ready. Import your first book to begin.',
      time: 'Just now',
    },
  ];

  const handleClearSearch = () => {
    onSearchChange('');
  };

  return (
    <header className="topbar-container">
      <div className="topbar-left">
        {/* Mobile menu trigger */}
        <button
          className="mobile-menu-btn"
          onClick={onToggleSidebar}
          aria-label="Open sidebar menu"
        >
          <Menu size={20} />
        </button>

        {/* Search input container */}
        <div className={`topbar-search-box ${isSearchFocused ? 'search-focused' : ''}`}>
          <Search className="search-icon" size={17} />
          <input
            type="text"
            className="search-input"
            placeholder="Search books, notes, topics..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
            aria-label="Search books and notes"
          />
          {searchQuery && (
            <button
              className="search-clear-btn"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}

          {/* Search Dropdown Results Preview if typing */}
          {searchQuery.trim().length > 0 && isSearchFocused && (
            <div className="search-dropdown-results">
              <div className="search-dropdown-header">
                <span>Matching items ({searchResults.length})</span>
                <span className="search-hint">Press Esc to dismiss</span>
              </div>

              {searchResults.length > 0 ? (
                <ul className="search-results-list">
                  {searchResults.map((item) => (
                    <li key={item.id} className="search-result-item">
                      <button
                        className="search-result-btn"
                        onMouseDown={() => onSelectSearchResult(item)}
                      >
                        <div className="result-icon-wrap">
                          <BookOpen size={15} />
                        </div>
                        <div className="result-meta">
                          <span className="result-title">{item.title}</span>
                          <span className="result-subtitle">
                            {item.category || 'General'} • {item.currentPage}/{item.totalPages} pages
                          </span>
                        </div>
                        <span className="result-badge">{item.format || 'Book'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="search-empty-state">
                  <p>No books or notes matching "{searchQuery}"</p>
                  <span className="search-empty-sub">
                    Try searching for "Data", "Mathematics", or "Systems"
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="topbar-right">
        {/* Notifications toggle */}
        <div className="notifications-wrapper">
          <button
            className={`topbar-icon-btn ${showNotifications ? 'active' : ''}`}
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && <span className="notification-dot" />}
          </button>

          {showNotifications && (
            <div className="notifications-dropdown">
              <div className="notif-header">
                <h3>Notifications</h3>
                <span className="notif-badge">{unreadCount} new</span>
              </div>
              <ul className="notif-list">
                {notifications.map((n) => (
                  <li key={n.id} className="notif-item">
                    <div className="notif-title-row">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-time">{n.time}</span>
                    </div>
                    <p className="notif-desc">{n.desc}</p>
                  </li>
                ))}
              </ul>
              <div className="notif-footer">
                <button
                  className="notif-close-btn"
                  onClick={() => setShowNotifications(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profile Avatar / Aks Login */}
        <div
          className="topbar-avatar"
          title={currentUser ? `Signed in as ${currentUser.name} — Click to switch account` : "Aks Sanctuary Reader — Click to Log In / Intro"}
          onClick={() => onOpenLogin && onOpenLogin()}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onOpenLogin && onOpenLogin();
            }
          }}
          aria-label={currentUser ? `Signed in as ${currentUser.name}` : "Log in to Aks"}
        >
          <div className="avatar-ring">
            <span className="avatar-initials">
              {currentUser?.name ? currentUser.name.slice(0, 2).toUpperCase() : 'अक्स'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
