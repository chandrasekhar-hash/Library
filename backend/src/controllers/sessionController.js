import crypto from 'crypto';
import { prisma } from '../services/prisma.js';
import { isValidUuid, parsePagination } from '../utils/validators.js';
import { DEFAULT_USER_PREFERENCES } from '../config/preferences.js';
import { withUserLock } from '../utils/userLock.js';

/**
 * Controller for Reading Sessions & Study Statistics in Aks (अक्स)
 *
 * Implements:
 * - Server-authoritative session lifecycle (start -> finish)
 * - Exact duration calculation derived from server timestamps (not trusting client-reported values)
 * - Safe retries via client-generated session IDs / idempotency keys
 * - Overlap & concurrency prevention (auto-closing abandoned or prior active sessions)
 * - Proportional reset boundary handling for sessions spanning studyTimeResetAt
 * - Complete preservation of historical ReadingSession records
 */

function sanitizeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    userId: session.userId,
    bookId: session.bookId,
    idempotencyKey: session.idempotencyKey || null,
    durationSeconds: session.durationSeconds,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    isActive: session.endedAt === null,
    createdAt: session.createdAt,
    book: session.book
      ? {
          id: session.book.id,
          title: session.book.title,
          author: session.book.author,
        }
      : null,
  };
}

/**
 * POST /api/books/:bookId/sessions/start
 * Server-authoritative session start.
 * Records authoritative start timestamp, persists idempotency key, and serializes operations
 * per user to prevent duplicate active sessions and race conditions.
 */
export async function startReadingSession(req, res, next) {
  try {
    const userId = req.userId;
    const { bookId } = req.params;
    const rawKey = req.body?.idempotencyKey || req.body?.clientSessionId || req.headers['idempotency-key'] || req.body?.sessionId;
    const idempotencyKey = (rawKey && typeof rawKey === 'string' && rawKey.trim().length > 0)
      ? rawKey.trim()
      : null;

    if (rawKey !== undefined && rawKey !== null && !idempotencyKey) {
      return res.status(400).json({
        error: {
          message: 'idempotencyKey must be a non-empty string.',
          code: 'INVALID_IDEMPOTENCY_KEY',
        },
      });
    }

    if (idempotencyKey && idempotencyKey.length > 128) {
      return res.status(400).json({
        error: {
          message: 'idempotencyKey must not exceed 128 characters.',
          code: 'INVALID_IDEMPOTENCY_KEY',
        },
      });
    }

    let linkedBookId = null;
    if (bookId) {
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid book ID format. Expected UUID.',
            code: 'INVALID_ID_FORMAT',
          },
        });
      }

      // Verify book ownership
      const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
      });

      if (!book) {
        return res.status(404).json({
          error: {
            message: 'Book not found or access denied.',
            code: 'BOOK_NOT_FOUND',
          },
        });
      }
      linkedBookId = book.id;
    }

    return await withUserLock(userId, async () => {
      // 1. Durable idempotency check
      if (idempotencyKey) {
        const orConditions = [{ idempotencyKey }];
        if (isValidUuid(idempotencyKey)) {
          orConditions.push({ id: idempotencyKey });
        }

        const existingSession = await prisma.readingSession.findFirst({
          where: {
            userId,
            OR: orConditions,
          },
          include: {
            book: { select: { id: true, title: true, author: true } },
          },
        });

        if (existingSession) {
          return res.status(200).json({
            message: 'Existing reading session retrieved (idempotent start).',
            session: sanitizeSession(existingSession),
          });
        }
      }

      const now = new Date();

      // 2. Concurrency prevention: Close any existing active session for this user
      // to prevent overlapping sessions from double-counting study time
      const openSession = await prisma.readingSession.findFirst({
        where: { userId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });

      if (openSession) {
        const elapsed = Math.round((now.getTime() - openSession.startedAt.getTime()) / 1000);
        const cappedDuration = Math.min(86400, Math.max(1, elapsed));
        await prisma.readingSession.update({
          where: { id: openSession.id },
          data: {
            endedAt: now,
            durationSeconds: cappedDuration,
          },
        });
      }

      // 3. Create new session with durable idempotencyKey, handling DB-level race
      try {
        const session = await prisma.readingSession.create({
          data: {
            id: (idempotencyKey && isValidUuid(idempotencyKey)) ? idempotencyKey : undefined,
            userId,
            bookId: linkedBookId,
            idempotencyKey: idempotencyKey || null,
            startedAt: now,
            endedAt: null,
            durationSeconds: 0,
          },
          include: {
            book: { select: { id: true, title: true, author: true } },
          },
        });

        return res.status(201).json({
          message: 'Reading session started successfully.',
          session: sanitizeSession(session),
        });
      } catch (createErr) {
        // P2002: Unique constraint violation on [userId, idempotencyKey] or [id]
        if (createErr.code === 'P2002' && idempotencyKey) {
          const raceExisting = await prisma.readingSession.findFirst({
            where: {
              userId,
              OR: [
                { idempotencyKey },
                ...(isValidUuid(idempotencyKey) ? [{ id: idempotencyKey }] : []),
              ],
            },
            include: {
              book: { select: { id: true, title: true, author: true } },
            },
          });
          if (raceExisting) {
            return res.status(200).json({
              message: 'Existing reading session retrieved (idempotent start).',
              session: sanitizeSession(raceExisting),
            });
          }
        }
        throw createErr;
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/books/:bookId/sessions/:sessionId/finish
 * Server-authoritative session finish.
 * Calculates duration from server timestamps, preventing client duration manipulation,
 * and serializes concurrent finish requests per user.
 */
export async function finishReadingSession(req, res, next) {
  try {
    const userId = req.userId;
    const { bookId, sessionId } = req.params;

    if (!isValidUuid(sessionId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid session ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    if (bookId && !isValidUuid(bookId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid book ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    return await withUserLock(userId, async () => {
      const session = await prisma.readingSession.findFirst({
        where: { id: sessionId, userId },
        include: {
          book: { select: { id: true, title: true, author: true } },
        },
      });

      if (!session) {
        return res.status(404).json({
          error: {
            message: 'Reading session not found or access denied.',
            code: 'SESSION_NOT_FOUND',
          },
        });
      }

      if (bookId && session.bookId && session.bookId !== bookId) {
        return res.status(400).json({
          error: {
            message: 'Session does not match the specified book.',
            code: 'SESSION_BOOK_MISMATCH',
          },
        });
      }

      // Idempotency: If already finished, return the finished record without recalculating
      if (session.endedAt !== null) {
        return res.status(200).json({
          message: 'Reading session already finished (idempotent finish).',
          session: sanitizeSession(session),
        });
      }

      // Server-authoritative completion
      const now = new Date();
      const rawElapsed = Math.round((now.getTime() - session.startedAt.getTime()) / 1000);

      // Apply minimum (1s) and maximum session ceiling (24 hours = 86400s)
      const durationSeconds = Math.min(86400, Math.max(1, rawElapsed));

      const updatedSession = await prisma.readingSession.update({
        where: { id: sessionId },
        data: {
          endedAt: now,
          durationSeconds,
        },
        include: {
          book: { select: { id: true, title: true, author: true } },
        },
      });

      return res.status(200).json({
        message: 'Reading session finished successfully.',
        session: sanitizeSession(updatedSession),
      });
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/sessions/active
 * Retrieve currently active session for the authenticated user (if any).
 */
export async function getActiveSession(req, res, next) {
  try {
    const userId = req.userId;
    const { bookId } = req.params;

    const where = { userId, endedAt: null };
    if (bookId) {
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: { message: 'Invalid book ID format.', code: 'INVALID_ID_FORMAT' },
        });
      }
      where.bookId = bookId;
    }

    const session = await prisma.readingSession.findFirst({
      where,
      orderBy: { startedAt: 'desc' },
      include: {
        book: { select: { id: true, title: true, author: true } },
      },
    });

    return res.status(200).json({
      activeSession: sanitizeSession(session),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/books/:bookId/sessions
 * Legacy/backward-compatible session submission.
 * Enforces strict timestamp consistency and bounds validation.
 */
export async function createReadingSession(req, res, next) {
  try {
    const userId = req.userId;
    const { bookId } = req.params;
    const { durationSeconds, startedAt, endedAt, clientSessionId } = req.body || {};

    let linkedBookId = null;
    if (bookId) {
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid book ID format. Expected UUID.',
            code: 'INVALID_ID_FORMAT',
          },
        });
      }

      // Verify book ownership
      const book = await prisma.book.findFirst({
        where: { id: bookId, userId },
      });

      if (!book) {
        return res.status(404).json({
          error: {
            message: 'Book not found or access denied.',
            code: 'BOOK_NOT_FOUND',
          },
        });
      }
      linkedBookId = book.id;
    }

    // Validate duration in seconds
    const parsedDuration = parseInt(durationSeconds, 10);
    if (isNaN(parsedDuration) || parsedDuration < 1 || parsedDuration > 86400) {
      return res.status(400).json({
        error: {
          message: 'durationSeconds must be an integer between 1 second and 86,400 seconds (24 hours).',
          code: 'INVALID_DURATION',
        },
      });
    }

    // Validate timestamps
    let startTime;
    if (startedAt) {
      startTime = new Date(startedAt);
      if (isNaN(startTime.getTime())) {
        return res.status(400).json({
          error: {
            message: 'Invalid startedAt timestamp format.',
            code: 'INVALID_TIMESTAMP',
          },
        });
      }
      // Must not be in the future (with 5 min grace window for clock drift)
      if (startTime.getTime() > Date.now() + 5 * 60 * 1000) {
        return res.status(400).json({
          error: {
            message: 'startedAt timestamp cannot be in the future.',
            code: 'INVALID_START_TIME',
          },
        });
      }
      // Must not be unreasonably old (> 30 days)
      if (startTime.getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: {
            message: 'startedAt timestamp cannot be older than 30 days.',
            code: 'TIMESTAMP_TOO_OLD',
          },
        });
      }
    } else {
      startTime = new Date(Date.now() - parsedDuration * 1000);
    }

    let endTime;
    if (endedAt) {
      endTime = new Date(endedAt);
      if (isNaN(endTime.getTime()) || endTime.getTime() < startTime.getTime()) {
        return res.status(400).json({
          error: {
            message: 'endedAt must be a valid timestamp greater than or equal to startedAt.',
            code: 'INVALID_END_TIME',
          },
        });
      }
      // Verify internal consistency: endedAt - startedAt must match durationSeconds within 5s tolerance
      const elapsed = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
      if (Math.abs(elapsed - parsedDuration) > 5) {
        return res.status(400).json({
          error: {
            message: `Duration (${parsedDuration}s) does not match timestamp interval (${elapsed}s).`,
            code: 'TIMESTAMPS_INCONSISTENT',
          },
        });
      }
    } else {
      endTime = new Date(startTime.getTime() + parsedDuration * 1000);
    }

    return await withUserLock(userId, async () => {
      // Idempotency: Check clientSessionId or idempotencyKey
      if (clientSessionId) {
        const orConditions = [{ idempotencyKey: String(clientSessionId) }];
        if (isValidUuid(clientSessionId)) {
          orConditions.push({ id: clientSessionId });
        }

        const existing = await prisma.readingSession.findFirst({
          where: {
            userId,
            OR: orConditions,
          },
          include: {
            book: { select: { id: true, title: true, author: true } },
          },
        });
        if (existing) {
          return res.status(200).json({
            message: 'Duplicate reading session detected; returned existing record.',
            session: sanitizeSession(existing),
          });
        }
      }

      const recentDuplicate = await prisma.readingSession.findFirst({
        where: {
          userId,
          bookId: linkedBookId,
          durationSeconds: parsedDuration,
          startedAt: {
            gte: new Date(startTime.getTime() - 2000),
            lte: new Date(startTime.getTime() + 2000),
          },
        },
      });

      if (recentDuplicate) {
        return res.status(200).json({
          message: 'Duplicate reading session detected; returned existing record.',
          session: sanitizeSession(recentDuplicate),
        });
      }

      try {
        const session = await prisma.readingSession.create({
          data: {
            id: (clientSessionId && isValidUuid(clientSessionId)) ? clientSessionId : undefined,
            userId,
            bookId: linkedBookId,
            idempotencyKey: clientSessionId ? String(clientSessionId) : null,
            durationSeconds: parsedDuration,
            startedAt: startTime,
            endedAt: endTime,
          },
          include: {
            book: {
              select: { id: true, title: true, author: true },
            },
          },
        });

        return res.status(201).json({
          message: 'Reading session recorded successfully.',
          session: sanitizeSession(session),
        });
      } catch (createErr) {
        if (createErr.code === 'P2002' && clientSessionId) {
          const raceExisting = await prisma.readingSession.findFirst({
            where: {
              userId,
              OR: [
                { idempotencyKey: String(clientSessionId) },
                ...(isValidUuid(clientSessionId) ? [{ id: clientSessionId }] : []),
              ],
            },
            include: {
              book: { select: { id: true, title: true, author: true } },
            },
          });
          if (raceExisting) {
            return res.status(200).json({
              message: 'Duplicate reading session detected; returned existing record.',
              session: sanitizeSession(raceExisting),
            });
          }
        }
        throw createErr;
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/statistics
 * Retrieve aggregate reading statistics, respecting studyTimeResetAt proportionally.
 */
export async function getStudyStatistics(req, res, next) {
  try {
    const userId = req.userId;

    // 1. Parallelize user preference, all-time aggregate, and 7-day daily window queries
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const [userPref, allTimeAggregate, dailySessions] = await Promise.all([
      prisma.userPreference.findUnique({
        where: { userId },
        select: { studyTimeResetAt: true },
      }),
      prisma.readingSession.aggregate({
        where: { userId, durationSeconds: { gt: 0 } },
        _sum: { durationSeconds: true },
        _count: { id: true },
      }),
      prisma.readingSession.findMany({
        where: {
          userId,
          durationSeconds: { gt: 0 },
          startedAt: { gte: sevenDaysAgo },
        },
        select: {
          durationSeconds: true,
          startedAt: true,
          endedAt: true,
        },
        orderBy: { startedAt: 'asc' },
      }),
    ]);

    const resetAt = userPref?.studyTimeResetAt || null;
    const allTimeStudyTimeSeconds = allTimeAggregate._sum.durationSeconds || 0;
    const allTimeSessionsCount = allTimeAggregate._count.id || 0;

    // 2. Active aggregate with proportional boundary handling
    let totalStudyTimeSeconds = 0;
    let totalSessionsCount = 0;

    if (!resetAt) {
      totalStudyTimeSeconds = allTimeStudyTimeSeconds;
      totalSessionsCount = allTimeSessionsCount;
    } else {
      // Fetch all sessions that ended after resetAt, or started after resetAt
      const relevantSessions = await prisma.readingSession.findMany({
        where: {
          userId,
          durationSeconds: { gt: 0 },
          OR: [
            { startedAt: { gte: resetAt } },
            { endedAt: { gt: resetAt } },
          ],
        },
        select: {
          durationSeconds: true,
          startedAt: true,
          endedAt: true,
        },
      });

      for (const s of relevantSessions) {
        if (s.startedAt >= resetAt) {
          totalStudyTimeSeconds += s.durationSeconds;
          totalSessionsCount += 1;
        } else if (s.endedAt && s.endedAt > resetAt) {
          // Boundary spanning session: count only the portion occurring after reset
          const postResetSeconds = Math.round((s.endedAt.getTime() - resetAt.getTime()) / 1000);
          const activePortion = Math.min(s.durationSeconds, Math.max(0, postResetSeconds));
          if (activePortion > 0) {
            totalStudyTimeSeconds += activePortion;
            totalSessionsCount += 1;
          }
        }
      }
    }

    const averageSessionDurationSeconds = totalSessionsCount > 0
      ? Math.round(totalStudyTimeSeconds / totalSessionsCount)
      : 0;

    // 3. Daily breakdown for the last 7 calendar days

    const dailyMap = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setUTCDate(d.getUTCDate() + i);
      const dateKey = d.toISOString().split('T')[0];
      dailyMap.set(dateKey, { date: dateKey, durationSeconds: 0, sessionCount: 0 });
    }

    for (const s of dailySessions) {
      const dateKey = s.startedAt.toISOString().split('T')[0];
      if (dailyMap.has(dateKey)) {
        let sessionActiveDuration = s.durationSeconds;
        if (resetAt) {
          if (s.startedAt >= resetAt) {
            sessionActiveDuration = s.durationSeconds;
          } else if (s.endedAt && s.endedAt > resetAt) {
            const postReset = Math.round((s.endedAt.getTime() - resetAt.getTime()) / 1000);
            sessionActiveDuration = Math.min(s.durationSeconds, Math.max(0, postReset));
          } else {
            sessionActiveDuration = 0;
          }
        }

        if (sessionActiveDuration > 0) {
          const item = dailyMap.get(dateKey);
          item.durationSeconds += sessionActiveDuration;
          item.sessionCount += 1;
        }
      }
    }

    const dailyStudyTime = Array.from(dailyMap.values());

    return res.status(200).json({
      statistics: {
        totalStudyTimeSeconds,
        allTimeStudyTimeSeconds,
        totalSessionsCount,
        allTimeSessionsCount,
        averageSessionDurationSeconds,
        lastResetAt: resetAt,
        dailyStudyTime,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/statistics/sessions
 * List individual reading sessions with pagination and filtering.
 */
export async function listReadingSessions(req, res, next) {
  try {
    const userId = req.userId;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { bookId, includeHistorical, status } = req.query;

    const userPref = await prisma.userPreference.findUnique({ where: { userId } });
    const resetAt = userPref?.studyTimeResetAt || null;

    const where = { userId };
    if (bookId) {
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid book ID format.',
            code: 'INVALID_ID_FORMAT',
          },
        });
      }
      where.bookId = bookId;
    }

    if (includeHistorical === 'false' && resetAt) {
      where.OR = [
        { startedAt: { gte: resetAt } },
        { endedAt: { gt: resetAt } },
      ];
    }

    if (status === 'active') {
      where.endedAt = null;
    } else if (status === 'finished') {
      where.endedAt = { not: null };
    }

    const [totalCount, sessions] = await Promise.all([
      prisma.readingSession.count({ where }),
      prisma.readingSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: {
          book: {
            select: { id: true, title: true, author: true },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      sessions: sessions.map(sanitizeSession),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: skip + limit < totalCount,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/statistics/reset
 * Non-destructively reset active study time by advancing studyTimeResetAt.
 * Preserves all historical ReadingSession records.
 */
export async function resetStudyTime(req, res, next) {
  try {
    const userId = req.userId;
    const now = new Date();

    await prisma.userPreference.upsert({
      where: { userId },
      update: {
        studyTimeResetAt: now,
      },
      create: {
        userId,
        readingConfig: DEFAULT_USER_PREFERENCES.readingConfig,
        typographyConfig: DEFAULT_USER_PREFERENCES.typographyConfig,
        annotationsConfig: DEFAULT_USER_PREFERENCES.annotationsConfig,
        atmosphereConfig: DEFAULT_USER_PREFERENCES.atmosphereConfig,
        storageConfig: DEFAULT_USER_PREFERENCES.storageConfig,
        studyTimeResetAt: now,
      },
    });

    return res.status(200).json({
      message: 'Study statistics reset successfully. Historical sessions remain preserved.',
      resetAt: now,
    });
  } catch (err) {
    next(err);
  }
}
