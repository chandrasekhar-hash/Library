import React, { useState } from 'react';
import { Bookmark, Sparkles } from 'lucide-react';

/**
 * Aks Tactile Book Cover
 * Renders an extracted PDF cover thumbnail or an elegant foil CSS fallback placeholder
 * with realistic 3D spine depth, tactile sheen, and gold foil accents.
 */
export default function BookCover({
  title,
  theme = {},
  coverUrl = null,
  coverImage = null,
  size = 'medium',
  className = '',
}) {
  const resolvedCoverSrc =
    coverUrl ||
    coverImage ||
    theme?.coverUrl ||
    theme?.coverImage ||
    null;

  const [imgFailed, setImgFailed] = useState(false);
  const [prevSrc, setPrevSrc] = useState(resolvedCoverSrc);
  if (resolvedCoverSrc !== prevSrc) {
    setPrevSrc(resolvedCoverSrc);
    setImgFailed(false);
  }

  const hasRealImage = Boolean(resolvedCoverSrc && !imgFailed);

  const {
    primary = '#1C2942',
    secondary = '#0E1726',
    accent = '#E7C18A',
    pattern = 'mesh-geo',
    initials = 'BK',
  } = theme || {};

  const sizeClasses = {
    small: 'book-cover-sm',
    medium: 'book-cover-md',
    large: 'book-cover-lg',
  }[size] || 'book-cover-md';

  return (
    <div
      className={`book-cover-container ${hasRealImage ? 'book-cover-container--has-image' : ''} ${sizeClasses} ${className}`}
      style={{
        '--cover-primary': primary,
        '--cover-secondary': secondary,
        '--cover-accent': accent,
      }}
      aria-label={`Book cover for ${title}`}
    >
      {/* 3D Book spine sheen */}
      <div className="book-spine-line" />

      {hasRealImage ? (
        <div className="book-cover-surface book-cover-surface--image">
          <img
            src={resolvedCoverSrc}
            alt={`Cover of ${title}`}
            className="book-cover-real-img"
            onError={() => setImgFailed(true)}
            loading="lazy"
          />
          {/* Subtle tactile lighting overlay */}
          <div className="book-cover-image-overlay" />
        </div>
      ) : (
        /* Cover content (Fallback pure CSS cover) */
        <div className="book-cover-surface">
          {/* Subtle geometric pattern overlay */}
          <div className={`book-pattern pattern-${pattern}`} />

          {/* Header corner icon / foil badge */}
          <div className="book-cover-badge">
            <Sparkles size={12} className="book-badge-icon" />
            <span className="book-badge-format">AKS ED.</span>
          </div>

          {/* Center embossed initials / emblem */}
          <div className="book-cover-emblem">
            <div className="emblem-circle">
              <span className="emblem-text">{initials}</span>
            </div>
          </div>

          {/* Bottom title & author excerpt */}
          <div className="book-cover-footer">
            <div className="book-cover-title-text">{title}</div>
            <div className="book-cover-foil-bar" />
          </div>
        </div>
      )}

      {/* Ribbon bookmark visual detail */}
      <div className="book-ribbon-tag">
        <Bookmark size={11} />
      </div>
    </div>
  );
}
