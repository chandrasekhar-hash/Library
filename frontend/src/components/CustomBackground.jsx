import React, { useRef, useEffect, useState, useMemo } from 'react';

/**
 * CustomBackground.jsx
 * Central, shared application layout background for Aks (अक्स) — A Reflection of You.
 *
 * Renders behind all main content and below TopBar, strictly leaving the left
 * fixed sidebar artwork (width: 218px) completely untouched.
 *
 * Features:
 * - Option A (Classic): signature Aks library artwork (/hero-image.png) on Home, ambient orbs on other pages.
 * - Option B (Upload Your Own): custom photo or looping video with dimming scrim, blur, positioning, and motion.
 * - Respects scope: 'home' (Home dashboard only) vs 'all' (all main pages).
 * - Smooth video playback with muted autoplay, playsInline, error fallback, and no unnecessary reinitialization.
 */
export default function CustomBackground({
  backgroundMode = 'classic',
  backgroundScope = 'home',
  customMedia = null,
  backgroundDimming = 20,
  blurIntensity = 0,
  positioning = 'center',
  motionEnabled = true,
  activeNav = 'home',
}) {
  const videoRef = useRef(null);
  const [playbackError, setPlaybackError] = useState(false);

  // Reset playback error state when the custom media URL changes
  useEffect(() => {
    setPlaybackError(false);
  }, [customMedia?.url]);

  // Ensure video element autoplays smoothly and handles motion toggle
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.defaultMuted = true;
    video.muted = true;

    if (motionEnabled) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // Autoplay policy or pause - keep muted without erroring out
          console.warn('[CustomBackground] Video autoplay notice:', err?.message || err);
        });
      }
    } else {
      video.pause();
    }
  }, [motionEnabled, customMedia?.url]);

  // Map focal positioning to CSS object-position
  const objectPositionStyle = useMemo(() => {
    switch (positioning) {
      case 'top':
        return 'center top';
      case 'bottom':
        return 'center bottom';
      case 'center':
      default:
        return 'center center';
    }
  }, [positioning]);

  // Do not render behind login (which has its own intro video) or reader
  if (activeNav === 'login' || activeNav === 'reader') {
    return null;
  }

  // Determine what to display:
  const isCustomActive =
    backgroundMode === 'custom' &&
    Boolean(customMedia?.url) &&
    !playbackError;

  const showCustomMedia =
    isCustomActive && (backgroundScope === 'all' || activeNav === 'home');

  const showClassicLibrary =
    backgroundMode === 'classic' && (backgroundScope === 'all' || activeNav === 'home');

  // Calculate dimming ratio: 0% to 80% maps to rgba opacity 0.35 to 0.85
  const clampedDimming = Math.max(0, Math.min(80, backgroundDimming ?? 20));
  const scrimOpacity = 0.38 + (clampedDimming / 100) * 0.45;

  const filterStyle =
    blurIntensity > 0 ? `blur(${Math.min(20, Math.max(0, blurIntensity))}px)` : undefined;

  return (
    <div className="sanctuary-background-wrapper" aria-hidden="true">
      {backgroundMode === 'pure-white' ? (
        /* Option C: Pure White background */
        <div
          className="pure-white-layer"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#FFFFFF',
          }}
        />
      ) : backgroundMode === 'pure-black' ? (
        /* Option D: Pure Black background */
        <div
          className="pure-black-layer"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#000000',
          }}
        />
      ) : showCustomMedia ? (
        <div className="custom-media-layer" style={{ filter: filterStyle }}>
          {customMedia.type === 'video' ? (
            <video
              ref={videoRef}
              key={customMedia.url}
              src={customMedia.url}
              autoPlay={motionEnabled}
              loop
              muted
              playsInline
              className="background-video-element"
              style={{
                objectPosition: objectPositionStyle,
                objectFit: 'cover',
              }}
              onError={() => {
                console.warn('[CustomBackground] Video playback error for:', customMedia.name);
                setPlaybackError(true);
              }}
            />
          ) : (
            <img
              key={customMedia.url}
              src={customMedia.url}
              alt="Custom Atmospheric Sanctuary Background"
              className="background-image-element"
              style={{
                objectPosition: objectPositionStyle,
                objectFit: 'cover',
              }}
              onError={() => {
                console.warn('[CustomBackground] Image failed to load:', customMedia.name);
                setPlaybackError(true);
              }}
            />
          )}

          {/* Dimming scrim overlay for text contrast */}
          <div
            className="background-scrim"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: `rgba(6, 10, 18, ${scrimOpacity})`,
              transition: 'background-color 200ms ease',
              pointerEvents: 'none',
            }}
          />

          {/* Soft atmospheric perimeter vignette */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse 95% 75% at 50% 30%, transparent 40%, rgba(6, 10, 18, 0.4) 80%, rgba(6, 10, 18, 0.72) 100%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      ) : showClassicLibrary ? (
        /* Option A (Classic) Aks Library Background on Home */
        <div className="classic-library-layer">
          <div className="home-sanctuary-backdrop" />
          <div className="home-sanctuary-vignette" />
        </div>
      ) : (
        /* Subtle ambient glow for default Aks backdrop on other pages */
        <div className="preset-mood-layer">
          <div
            className="mood-ambient-orb orb-primary"
            style={{
              background:
                'radial-gradient(circle, rgba(231, 193, 138, 0.08) 0%, transparent 70%)',
              animation: motionEnabled
                ? 'floatAmbient 18s ease-in-out infinite alternate'
                : 'none',
            }}
          />
          <div
            className="mood-ambient-orb orb-secondary"
            style={{
              background:
                'radial-gradient(circle, rgba(46, 75, 110, 0.18) 0%, transparent 65%)',
              animation: motionEnabled
                ? 'floatAmbient 18s ease-in-out infinite alternate'
                : 'none',
            }}
          />
          <div className="atmospheric-dust-overlay" />
        </div>
      )}
    </div>
  );
}
