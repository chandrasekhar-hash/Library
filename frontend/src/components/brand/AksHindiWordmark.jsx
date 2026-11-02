import React from 'react';

/**
 * AksHindiWordmark
 *
 * Renders the handcrafted Devanagari calligraphy wordmark “अक्स” for the Aks brand.
 * Styled with an authentic artistic pen-stroke flow, sweeping ligatures (क् + स),
 * and a luminous champagne-gold / antique-ivory finish.
 *
 * Supports responsive display sizes: 'sm' | 'md' | 'lg' | 'display'
 */
export default function AksHindiWordmark({
  className = '',
  size = 'md',
  style = {},
  variant = 'calligraphy',
}) {
  return (
    <span
      className={`brand-wordmark-hindi brand-wordmark-hindi-${size} brand-wordmark-hindi-${variant} ${className}`}
      lang="hi"
      aria-label="अक्स"
      role="text"
      style={style}
    >
      अक्स
    </span>
  );
}
