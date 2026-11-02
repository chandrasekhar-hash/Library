import crypto from 'crypto';
import { registerUser, authenticateCredentials } from '../services/authService.js';
import { sessionCookieOptions } from '../middleware/session.js';
import { getOrCreateCsrfToken } from '../middleware/csrf.js';
import { env } from '../config/env.js';
import { prisma } from '../services/prisma.js';
import { hashPassword } from '../services/passwordService.js';
import { normalizeEmail } from '../utils/validators.js';
import { DEFAULT_USER_PREFERENCES } from '../config/preferences.js';

/**
 * Controller for Aks (अक्स) Authentication.
 */

/**
 * GET /api/auth/csrf
 * Retrieve the CSRF token associated with the current session.
 */
export async function getCsrfToken(req, res, next) {
  try {
    const csrfToken = getOrCreateCsrfToken(req);

    // Ensure session is saved with the token
    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({ csrfToken });
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/register
 * Register a new user account.
 */
export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    const { user } = await registerUser({ name, email, password });

    res.status(201).json({
      message: 'Account registered successfully.',
      user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Authenticate user, regenerate session, and configure Remember Me.
 */
export async function login(req, res, next) {
  try {
    const { email, password, rememberMe } = req.body || {};

    const user = await authenticateCredentials({ email, password });
    if (!user) {
      return res.status(401).json({
        error: {
          message: 'Incorrect email or password.',
          code: 'INVALID_CREDENTIALS',
        },
      });
    }

    // Regenerate session ID to prevent session fixation attacks
    req.session.regenerate((err) => {
      if (err) {
        console.error('[AuthController] Error regenerating session:', err);
        return next(err);
      }

      // Associate authenticated user ID with new session
      req.session.userId = user.id;

      // Generate a fresh CSRF token for the new session
      const freshCsrfToken = crypto.randomBytes(32).toString('hex');
      req.session.csrfToken = freshCsrfToken;

      // Configure Remember Me:
      // Checked: persistent 30-day session cookie
      // Unchecked: browser-session cookie (cleared when browser closes)
      if (rememberMe === true) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      } else {
        req.session.cookie.expires = false;
        req.session.cookie.maxAge = undefined;
      }

      // Explicitly persist session before sending response
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[AuthController] Error saving session post-login:', saveErr);
          return next(saveErr);
        }

        res.status(200).json({
          message: 'Login successful.',
          user,
          csrfToken: freshCsrfToken,
        });
      });
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Invalidate current session and clear session cookie.
 */
export async function logout(req, res, next) {
  try {
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          console.error('[AuthController] Error destroying session on logout:', err);
        }
        res.clearCookie(env.SESSION_COOKIE_NAME, sessionCookieOptions);
        res.status(200).json({
          message: 'Successfully logged out.',
        });
      });
    } else {
      res.clearCookie(env.SESSION_COOKIE_NAME, sessionCookieOptions);
      res.status(200).json({
        message: 'Successfully logged out.',
      });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Return currently authenticated user data.
 */
export async function me(req, res) {
  // req.user is guaranteed and sanitized by requireAuth middleware
  res.status(200).json({
    user: req.user,
  });
}

/**
 * GET /api/auth/google/status
 * Check if Google OAuth 2.0 is configured on the server.
 */
export async function getGoogleAuthStatus(req, res) {
  res.status(200).json({
    configured: env.IS_GOOGLE_OAUTH_CONFIGURED,
  });
}

/**
 * GET /api/auth/google
 * Initiate Google OAuth 2.0 flow with state validation.
 */
export async function initiateGoogleAuth(req, res) {
  if (!env.IS_GOOGLE_OAUTH_CONFIGURED) {
    return res.redirect(`${env.FRONTEND_URL}/?auth_error=google_not_configured`);
  }

  // Generate a cryptographically secure random state to protect against CSRF
  const oauthState = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = oauthState;

  req.session.save((err) => {
    if (err) {
      console.error('[AuthController] Error saving session for Google OAuth state:', err);
      return res.redirect(`${env.FRONTEND_URL}/?auth_error=oauth_initiation_failed`);
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope: 'openid email profile',
      state: oauthState,
      access_type: 'online',
      prompt: 'select_account',
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });
}

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth 2.0 callback, exchange code, verify identity, create/link user, establish session.
 */
export async function handleGoogleCallback(req, res, next) {
  const { code, state, error } = req.query || {};

  if (error) {
    console.warn('[AuthController] Google OAuth error parameter received:', error);
    return res.redirect(`${env.FRONTEND_URL}/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${env.FRONTEND_URL}/?auth_error=missing_oauth_params`);
  }

  const expectedState = req.session?.oauthState;
  // Clear the state from session immediately to prevent reuse
  if (req.session) {
    delete req.session.oauthState;
  }

  if (!expectedState || state !== expectedState) {
    console.warn('[AuthController] Google OAuth state mismatch or missing');
    return res.redirect(`${env.FRONTEND_URL}/?auth_error=invalid_oauth_state`);
  }

  if (!env.IS_GOOGLE_OAUTH_CONFIGURED) {
    return res.redirect(`${env.FRONTEND_URL}/?auth_error=google_not_configured`);
  }

  try {
    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const tokenErr = await tokenResponse.text();
      console.error('[AuthController] Google token exchange failed:', tokenErr);
      return res.redirect(`${env.FRONTEND_URL}/?auth_error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Fetch authenticated profile info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userInfoResponse.ok) {
      const userErr = await userInfoResponse.text();
      console.error('[AuthController] Google userinfo fetch failed:', userErr);
      return res.redirect(`${env.FRONTEND_URL}/?auth_error=userinfo_fetch_failed`);
    }

    const userInfo = await userInfoResponse.json();

    // 3. Security requirement: Verify email_verified is explicitly true to prevent account takeover
    if (userInfo.email_verified !== true && userInfo.email_verified !== 'true') {
      console.warn('[AuthController] Google account email is not verified:', userInfo.email);
      return res.redirect(`${env.FRONTEND_URL}/?auth_error=unverified_google_email`);
    }

    if (!userInfo.email) {
      return res.redirect(`${env.FRONTEND_URL}/?auth_error=missing_google_email`);
    }

    const normalizedEmail = normalizeEmail(userInfo.email);
    const displayName = (userInfo.name || userInfo.email.split('@')[0] || 'Reflective Reader').trim();
    const avatarUrl = userInfo.picture || null;

    // 4. Safe user lookup or registration
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Create new user account with secure unguessable random Argon2id password hash
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);

      user = await prisma.user.create({
        data: {
          name: displayName,
          email: normalizedEmail,
          passwordHash,
          avatarUrl,
          preference: {
            create: DEFAULT_USER_PREFERENCES,
          },
        },
      });
    }

    // 5. Establish authenticated session using existing architecture
    req.session.regenerate((err) => {
      if (err) {
        console.error('[AuthController] Error regenerating session for Google OAuth user:', err);
        return res.redirect(`${env.FRONTEND_URL}/?auth_error=session_regeneration_failed`);
      }

      req.session.userId = user.id;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[AuthController] Error saving session post-Google OAuth:', saveErr);
          return res.redirect(`${env.FRONTEND_URL}/?auth_error=session_save_failed`);
        }

        res.redirect(`${env.FRONTEND_URL}/?auth_success=google`);
      });
    });
  } catch (oauthErr) {
    console.error('[AuthController] Unhandled Google OAuth callback exception:', oauthErr);
    res.redirect(`${env.FRONTEND_URL}/?auth_error=oauth_internal_error`);
  }
}

