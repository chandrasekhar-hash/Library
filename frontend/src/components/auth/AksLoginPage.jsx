import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Volume2,
  VolumeX,
  FastForward,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { authApi } from '../../services/api';
import '../../styles/aksLogin.css';

// Native 1.0x playback rate matches display refresh rate (60Hz / 120Hz)
// with 0 pulldown judder and smooth continuous camera tracking.
const PLAYBACK_RATE = 1.0;

export default function AksLoginPage({
  onLoginSuccess,
  onExploreAsGuest,
  onBackToSanctuary,
  initialVideoSkipped = false,
}) {
  const videoRef = useRef(null);

  // Intro video states
  const [isFadeReady, setIsFadeReady] = useState(false);
  const [introEnded, setIntroEnded] = useState(() => {
    if (initialVideoSkipped) return true;
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });
  const [isMuted, setIsMuted] = useState(true);
  const [showControls, setShowControls] = useState(true);

  // Form states
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('aks_remember_email') || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToastMsg = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3600);
  };

  // Configure native video playback once on mount and manage play state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Use native 1.0x speed for hardware-accelerated, judder-free 60fps playback
    video.playbackRate = PLAYBACK_RATE;
    video.defaultPlaybackRate = PLAYBACK_RATE;

    if (introEnded) {
      video.currentTime = Math.max(0, (video.duration || 8.45) - 0.05);
      video.pause();
      setIsFadeReady(true);
      return;
    }

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('[AksLoginPage] Autoplay notice:', err);
        setIsFadeReady(true);
      });
    }

    return () => {
      if (video) {
        video.pause();
      }
    };
  }, [introEnded]);

  // When video begins active playback, trigger smooth black fade-out
  const handlePlaying = () => {
    requestAnimationFrame(() => {
      setIsFadeReady(true);
    });
  };

  // Synchronize transition with video completion without redundant state updates
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || introEnded) return;

    // Once the video reaches its final stationary frame (~duration - 0.15s)
    if (video.duration && video.currentTime >= video.duration - 0.15) {
      video.pause();
      setIntroEnded(true);
    }
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    setIntroEnded(true);
  };

  // Skip Intro handler: immediately jump to the final stationary book shot
  const handleSkipIntro = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      try {
        video.currentTime = Math.max(0, (video.duration || 8.45) - 0.05);
        video.pause();
      } catch (_) {}
    }
    setIsFadeReady(true);
    setIntroEnded(true);
    showToastMsg('Welcome to Aks — A Reflection of You', 'success');
  }, []);

  // Mute / Unmute handler
  const handleToggleMute = () => {
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
      setIsMuted(video.muted);
    }
  };

  // Handle OAuth callback parameters on mount (e.g. ?auth_success=google or ?auth_error=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get('auth_success');
    const authError = urlParams.get('auth_error');

    if (authSuccess === 'google') {
      window.history.replaceState({}, document.title, window.location.pathname);
      authApi
        .getCurrentUser()
        .then((user) => {
          if (user) {
            showToastMsg(`Welcome back to Aks, ${user.name || 'Reader'}!`, 'success');
            if (onLoginSuccess) {
              setTimeout(() => onLoginSuccess(user), 400);
            }
          }
        })
        .catch(() => {
          showToastMsg('Unable to restore session. Please log in.', 'error');
        });
    } else if (authError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      let errorMsg = 'Google authentication was cancelled or failed. Please try again.';
      if (authError === 'google_not_configured') {
        errorMsg = 'Google Sign-In is not configured in this environment.';
      } else if (authError === 'invalid_oauth_state') {
        errorMsg = 'Google authentication failed (invalid session state). Please try again.';
      } else if (authError === 'unverified_google_email') {
        errorMsg = 'Your Google account email is not verified. Please verify it with Google first.';
      } else if (authError === 'access_denied') {
        errorMsg = 'Google authentication was cancelled.';
      }
      showToastMsg(errorMsg, 'error');
    }
  }, [onLoginSuccess]);

  // Form submit handler with real backend authentication
  const handleSubmit = async (e) => {
    e.preventDefault();

    const trimmedEmail = email ? email.trim() : '';
    if (!trimmedEmail) {
      showToastMsg('Please enter your email address.', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      showToastMsg('Please enter a valid email address.', 'error');
      return;
    }

    if (!password) {
      showToastMsg('Please enter your password.', 'error');
      return;
    }

    if (isSignUp && password.length < 8) {
      showToastMsg('Password must be at least 8 characters.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        const username = trimmedEmail.split('@')[0];
        const displayName = name.trim() || username.charAt(0).toUpperCase() + username.slice(1);
        await authApi.register({
          email: trimmedEmail,
          password,
          name: displayName,
        });

        // Automatically log in after registration to establish session cookie
        const loginRes = await authApi.login({
          email: trimmedEmail,
          password,
          rememberMe,
        });

        if (rememberMe) {
          try {
            localStorage.setItem('aks_remember_email', trimmedEmail);
          } catch (_) {}
        } else {
          try {
            localStorage.removeItem('aks_remember_email');
          } catch (_) {}
        }

        showToastMsg(`Welcome to Aks, ${loginRes.user?.name || displayName}!`, 'success');
        if (onLoginSuccess) {
          setTimeout(() => onLoginSuccess(loginRes.user), 400);
        }
      } else {
        const res = await authApi.login({
          email: trimmedEmail,
          password,
          rememberMe,
        });

        if (rememberMe) {
          try {
            localStorage.setItem('aks_remember_email', trimmedEmail);
          } catch (_) {}
        } else {
          try {
            localStorage.removeItem('aks_remember_email');
          } catch (_) {}
        }

        showToastMsg(`Welcome back to Aks, ${res.user?.name || 'Reader'}!`, 'success');
        if (onLoginSuccess) {
          setTimeout(() => onLoginSuccess(res.user), 400);
        }
      }
    } catch (err) {
      console.error('[AksLoginPage] Auth error:', err);
      let errorMsg;
      if (
        err.isNetworkError ||
        err.statusCode === 0 ||
        err.status === 0 ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('Network connection failed') ||
        err.message?.includes('Unable to connect')
      ) {
        errorMsg = 'Unable to connect to Aks. Please check your connection and try again.';
      } else if (
        err.status === 401 ||
        err.statusCode === 401 ||
        err.code === 'INVALID_CREDENTIALS' ||
        err.message?.toLowerCase().includes('password') ||
        err.message?.toLowerCase().includes('credential')
      ) {
        errorMsg = 'Incorrect email or password.';
      } else if (err.status >= 500 || err.statusCode >= 500) {
        errorMsg = 'Something went wrong. Please try again.';
      } else {
        errorMsg =
          err.details?.map((d) => d.message).join(' ') ||
          err.message ||
          'Something went wrong. Please try again.';
      }
      showToastMsg(errorMsg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Forgot password handler
  const handleForgotPassword = (e) => {
    e.preventDefault();
    if (!email) {
      showToastMsg('Enter your email above to receive a recovery link.', 'info');
    } else {
      showToastMsg(`Password recovery link dispatched to ${email}`, 'success');
    }
  };

  return (
    <main className="aks-login-viewport" aria-label="Aks Login Sanctuary">
      {/* ── 16:9 Book Stage ─────────────────────────────────────────────────── */}
      <div className="aks-stage-container">
        {/* Cinematic Video Layer */}
        <video
          ref={videoRef}
          className="aks-cinematic-video"
          src="/login%20video.mp4"
          playsInline
          muted={isMuted}
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={handlePlaying}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleVideoEnded}
          aria-label="Aks cinematic library intro: floating book lands and opens on the sanctuary desk"
        />

        {/* Cinematic Black Fade Curtain: begins 100% black, dissolves into opening video frame */}
        <div
          className={`aks-black-curtain ${isFadeReady ? 'is-faded' : ''}`}
          aria-hidden="true"
        />

        {/* Cinematic Controls (Top Right: Sound & Skip Intro) */}
        {showControls && (
          <nav className="aks-cinematic-controls" aria-label="Intro controls">
            <button
              type="button"
              className="aks-control-btn"
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute soundtrack' : 'Mute soundtrack'}
              aria-label={isMuted ? 'Unmute soundtrack' : 'Mute soundtrack'}
            >
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              <span>{isMuted ? 'Sound Off' : 'Sound On'}</span>
            </button>

            {!introEnded && (
              <button
                type="button"
                className="aks-control-btn"
                onClick={handleSkipIntro}
                title="Skip intro directly to login"
                aria-label="Skip intro to login"
              >
                <span>Skip Intro</span>
                <FastForward size={14} />
              </button>
            )}

            {onBackToSanctuary && (
              <button
                type="button"
                className="aks-control-btn"
                onClick={onBackToSanctuary}
                title="Return to Reading Sanctuary"
                aria-label="Return to Reading Sanctuary"
              >
                <BookOpen size={14} />
                <span>Return to Library</span>
              </button>
            )}
          </nav>
        )}

        {/* Stationary Open-Book Interactive Layer */}
        <section
          className={`aks-book-interactive-layer ${introEnded ? 'is-visible' : ''}`}
          aria-label="Stationary open-book login composition"
        >
          {/* Left Page Zone: Accessible marker only.
              The video itself provides the moonlit sanctuary artwork,
              Hindi 'अक्स', 'A Reflection of You', and the quote:
              “Read a little, live a little, reflect a little more.”
              No duplicate React text is overlaid. */}
          <div
            className="aks-left-page-zone"
            aria-label="Aks moonlit sanctuary: Read a little, live a little, reflect a little more."
          />

          {/* Right Page Zone: Antique Parchment Interactive Form.
              The video itself provides Aks in cursive, crescent moon 🌙,
              'Welcome' heading, and 'A Reflection of You'.
              The interactive form sits cleanly in the usable parchment writing area below. */}
          <div className="aks-right-page-zone" aria-label="Interactive Login Form">
            {/* If in Sign-Up mode, render a subtle indicator */}
            {isSignUp && (
              <div className="aks-signup-badge" role="status">
                <span>Create Sanctuary Account</span>
              </div>
            )}

            {/* Interactive Form */}
            <form className="aks-parchment-form" onSubmit={handleSubmit} noValidate>
              {/* Optional Name Field for Sign-Up */}
              {isSignUp && (
                <div className="aks-input-group">
                  <label className="aks-input-label" htmlFor="aks-name-input">
                    Your Name
                  </label>
                  <div className="aks-input-wrapper">
                    <User size={14} className="aks-input-icon" aria-hidden="true" />
                    <input
                      id="aks-name-input"
                      type="text"
                      name="name"
                      className="aks-input-field"
                      placeholder="Reflective Reader"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </div>
              )}

              {/* Email Field */}
              <div className="aks-input-group">
                <label className="aks-input-label" htmlFor="aks-email-input">
                  Email Address
                </label>
                <div className="aks-input-wrapper">
                  <Mail size={14} className="aks-input-icon" aria-hidden="true" />
                  <input
                    id="aks-email-input"
                    type="email"
                    name="email"
                    className="aks-input-field"
                    placeholder="reader@aks.sanctuary"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="aks-input-group">
                <label className="aks-input-label" htmlFor="aks-password-input">
                  Password (min 8 chars)
                </label>
                <div className="aks-input-wrapper">
                  <Lock size={14} className="aks-input-icon" aria-hidden="true" />
                  <input
                    id="aks-password-input"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    className="aks-input-field"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  />
                  <button
                    type="button"
                    className="aks-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Utilities Row: Remember Me & Forgot Password on the same row */}
              <div className="aks-form-row">
                <label className="aks-remember-label">
                  <input
                    type="checkbox"
                    className="aks-checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>

                {!isSignUp && (
                  <a
                    href="#forgot"
                    className="aks-forgot-link"
                    onClick={handleForgotPassword}
                  >
                    Forgot password?
                  </a>
                )}
              </div>

              {/* Primary Action Button */}
              <button
                type="submit"
                className="aks-primary-submit-btn"
                disabled={isSubmitting}
              >
                <span>
                  {isSubmitting
                    ? 'Authenticating...'
                    : isSignUp
                    ? 'Create Sanctuary Account'
                    : 'Log In'}
                </span>
                <ArrowRight size={15} />
              </button>

              {/* Sign Up / Log In Toggle */}
              <div className="aks-signup-prompt">
                <span>{isSignUp ? 'Already have an account?' : "Don't have an account?"}</span>{' '}
                <button
                  type="button"
                  className="aks-signup-btn"
                  onClick={() => setIsSignUp(!isSignUp)}
                >
                  {isSignUp ? 'Log In' : 'Sign Up'}
                </button>
              </div>

              {/* Guest Exploration Option */}
              <div className="aks-guest-explore-row">
                <button
                  type="button"
                  className="aks-guest-explore-btn"
                  onClick={onExploreAsGuest}
                >
                  <BookOpen size={12} />
                  <span>Explore library without signing in →</span>
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>

      {/* Auth Feedback Toast */}
      {toast && (
        <div className="aks-auth-toast" role="status" aria-live="polite">
          {toast.type === 'success' && <CheckCircle2 size={16} color="#67B8A2" />}
          {toast.type === 'error' && <AlertCircle size={16} color="#EF4444" />}
          {toast.type === 'info' && <Sparkles size={16} color="#E7C18A" />}
          <span>{toast.msg}</span>
        </div>
      )}
    </main>
  );
}
