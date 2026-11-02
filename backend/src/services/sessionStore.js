import session from 'express-session';
import { prisma as defaultPrisma } from './prisma.js';

/**
 * Custom Prisma-backed session store for express-session.
 * Implements the standard express-session Store interface:
 * get, set, destroy, touch, all, length, clear, clearUserSessions, pruneExpiredSessions.
 */
export class PrismaSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.prisma = options.prisma || defaultPrisma;
    this.defaultTtlMs = options.ttlMs || 30 * 24 * 60 * 60 * 1000; // 30 days default
  }

  /**
   * Calculates the expiration timestamp for a session.
   * @param {Object} sessionData
   * @returns {Date}
   */
  _getExpiresAt(sessionData) {
    if (sessionData?.cookie?.expires) {
      return new Date(sessionData.cookie.expires);
    }
    const maxAge = sessionData?.cookie?.maxAge || this.defaultTtlMs;
    return new Date(Date.now() + maxAge);
  }

  /**
   * Extracts user ID from session payload if authenticated.
   * Supports req.session.userId or nested session.user.id.
   * @param {Object} sessionData
   * @returns {string|null}
   */
  _extractUserId(sessionData) {
    if (!sessionData) return null;
    return sessionData.userId || sessionData.user?.id || sessionData.passport?.user || null;
  }

  /**
   * Fetch a session by its session ID.
   * @param {string} sid
   * @param {Function} callback (err, session)
   */
  get = async (sid, callback = () => {}) => {
    try {
      const record = await this.prisma.session.findUnique({
        where: { sid },
      });

      if (!record) {
        return callback(null, null);
      }

      // Check if session has expired
      if (record.expiresAt && record.expiresAt < new Date()) {
        // Destroy expired session asynchronously
        this.destroy(sid, () => {});
        return callback(null, null);
      }

      let sessionData;
      try {
        sessionData = JSON.parse(record.data);
      } catch (parseErr) {
        console.warn(`[SessionStore] Corrupted session data for sid=${sid}, pruning:`, parseErr);
        this.destroy(sid, () => {});
        return callback(null, null);
      }

      return callback(null, sessionData);
    } catch (err) {
      console.error('[SessionStore] Error in get():', err);
      return callback(err);
    }
  };

  /**
   * Commit session data to the database.
   * @param {string} sid
   * @param {Object} sessionData
   * @param {Function} callback (err)
   */
  set = async (sid, sessionData, callback = () => {}) => {
    try {
      const expiresAt = this._getExpiresAt(sessionData);
      const userId = this._extractUserId(sessionData);
      const dataString = JSON.stringify(sessionData);

      // Upsert session record
      await this.prisma.session.upsert({
        where: { sid },
        update: {
          data: dataString,
          expiresAt,
          userId: userId || null,
        },
        create: {
          sid,
          data: dataString,
          expiresAt,
          userId: userId || null,
        },
      });

      return callback(null);
    } catch (err) {
      console.error('[SessionStore] Error in set():', err);
      return callback(err);
    }
  };

  /**
   * Destroy the session with the given sid.
   * @param {string} sid
   * @param {Function} callback (err)
   */
  destroy = async (sid, callback = () => {}) => {
    try {
      await this.prisma.session.deleteMany({
        where: { sid },
      });
      return callback(null);
    } catch (err) {
      console.error('[SessionStore] Error in destroy():', err);
      return callback(err);
    }
  };

  /**
   * Refresh session expiry timestamp without reserializing full session payload.
   * @param {string} sid
   * @param {Object} sessionData
   * @param {Function} callback (err)
   */
  touch = async (sid, sessionData, callback = () => {}) => {
    try {
      const expiresAt = this._getExpiresAt(sessionData);
      const userId = this._extractUserId(sessionData);

      await this.prisma.session.updateMany({
        where: { sid },
        data: {
          expiresAt,
          ...(userId !== undefined ? { userId: userId || null } : {}),
        },
      });

      return callback(null);
    } catch (err) {
      console.error('[SessionStore] Error in touch():', err);
      return callback(err);
    }
  };

  /**
   * Clear all active sessions for a specific user (e.g. on password reset or remote logout).
   * @param {string} userId
   * @returns {Promise<number>} count of deleted sessions
   */
  clearUserSessions = async (userId) => {
    if (!userId) return 0;
    try {
      const result = await this.prisma.session.deleteMany({
        where: { userId },
      });
      return result.count;
    } catch (err) {
      console.error(`[SessionStore] Error clearing sessions for user ${userId}:`, err);
      throw err;
    }
  };

  /**
   * Clean up expired sessions from the database.
   * @returns {Promise<number>} count of pruned sessions
   */
  pruneExpiredSessions = async () => {
    try {
      const result = await this.prisma.session.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      return result.count;
    } catch (err) {
      console.error('[SessionStore] Error pruning expired sessions:', err);
      throw err;
    }
  };
}

export const sessionStore = new PrismaSessionStore();
