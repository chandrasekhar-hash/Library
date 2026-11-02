import session from 'express-session';
import { env } from '../config/env.js';
import { sessionStore } from '../services/sessionStore.js';

/**
 * Standard cookie configuration for Aks session cookies.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.IS_PRODUCTION,
  path: '/',
};

/**
 * Express-session middleware instance configured with PrismaSessionStore.
 */
export const sessionMiddleware = session({
  name: env.SESSION_COOKIE_NAME,
  secret: env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    ...sessionCookieOptions,
    // By default, sessions are browser-session cookies unless Remember Me is explicitly requested
    maxAge: undefined,
  },
});

/**
 * Helper to initialize hourly background pruning of expired sessions.
 */
let pruneIntervalId = null;
export function startSessionPruning(intervalMs = 60 * 60 * 1000) {
  if (pruneIntervalId) return;

  pruneIntervalId = setInterval(async () => {
    try {
      const pruned = await sessionStore.pruneExpiredSessions();
      if (pruned > 0) {
        console.log(`[SessionStore] Pruned ${pruned} expired session(s).`);
      }
    } catch (err) {
      console.error('[SessionStore] Error during periodic pruning:', err.message);
    }
  }, intervalMs);

  // Allow process to exit cleanly without waiting on interval
  if (pruneIntervalId.unref) {
    pruneIntervalId.unref();
  }
}
