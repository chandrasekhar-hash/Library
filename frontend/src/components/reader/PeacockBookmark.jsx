/**
 * PeacockBookmark.jsx
 * Aks (अक्स) Physical Reading Room — Physical Large Peacock Bookmark
 *
 * Renders the authentic, transparent-background large peacock artwork
 * resting gracefully on the bookmarked page or frame.
 * Maintains original 2:3 aspect ratio without rectangular boxes or recoloring.
 * Exactly one peacock is rendered across the entire Reading Room.
 */
import React from 'react';
import peacockImg from '../../assets/peacock.png';

export default function PeacockBookmark({
  page,
  side = 'left', // 'left' | 'right' | 'mobile' | 'frame-left' | 'frame-right'
  onClick,
  title,
}) {
  const isClickable = typeof onClick === 'function';
  const defaultTitle = isClickable
    ? `Page ${page} bookmarked. Click to remove.`
    : `Page ${page} bookmarked.`;

  const className = side.startsWith('frame')
    ? `book-frame-saved-peacock ${side === 'frame-right' ? 'book-frame-saved-peacock--right' : ''}`
    : `book-page-large-peacock ${
        side === 'right'
          ? 'book-page-large-peacock--right'
          : side === 'mobile'
          ? 'book-page-large-peacock--mobile'
          : ''
      }`;

  return (
    <div
      className={className}
      data-page={page}
      data-side={side}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : 'img'}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      title={title || defaultTitle}
      aria-label={title || defaultTitle}
    >
      <img
        src={peacockImg || '/peacock.png'}
        alt={`Peacock bookmark on page ${page}`}
        className="book-page-large-peacock-img"
        draggable={false}
      />
    </div>
  );
}
