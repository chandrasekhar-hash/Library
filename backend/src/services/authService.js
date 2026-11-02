import { prisma } from './prisma.js';
import { hashPassword, verifyPassword } from './passwordService.js';
import { normalizeEmail, validateRegistrationInput, validateLoginInput } from '../utils/validators.js';
import { sessionStore } from './sessionStore.js';
import { DEFAULT_USER_PREFERENCES } from '../config/preferences.js';

/**
 * Register a new user account.
 *
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<{ user: Object }>}
 */
export async function registerUser({ name, email, password }) {
  const validation = validateRegistrationInput({ name, email, password });
  if (!validation.isValid) {
    const error = new Error(validation.error);
    error.status = 400;
    error.code = 'INVALID_REGISTRATION_INPUT';
    throw error;
  }

  const { trimmedName, normalizedEmail } = validation;

  // Hash password using Argon2id with strict security parameters
  const passwordHash = await hashPassword(password);

  try {
    // Atomically create user and default preferences
    const newUser = await prisma.user.create({
      data: {
        name: trimmedName,
        email: normalizedEmail,
        passwordHash,
        preference: {
          create: DEFAULT_USER_PREFERENCES,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    return { user: newUser };
  } catch (err) {
    // Handle Prisma unique constraint violation (P2002 on User.email)
    if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
      const conflictError = new Error('An account with this email address already exists.');
      conflictError.status = 409;
      conflictError.code = 'EMAIL_ALREADY_EXISTS';
      throw conflictError;
    }
    throw err;
  }
}

/**
 * Authenticate user credentials.
 * Protects against timing/enumeration attacks by always executing verification logic.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<Object|null>} Safe user object on success, null on invalid credentials
 */
export async function authenticateCredentials({ email, password }) {
  const validation = validateLoginInput({ email, password });
  if (!validation.isValid) {
    return null;
  }

  const normalizedEmail = validation.normalizedEmail;

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  if (!user) {
    // Perform dummy verify to equalize response timing and avoid email enumeration
    await verifyPassword(
      '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$c29tZXNhbHQ',
      password
    );
    return null;
  }

  const isValid = await verifyPassword(user.passwordHash, password);
  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

/**
 * Invalidate all active sessions for a specific user ID across all devices/browsers.
 *
 * @param {string} userId
 * @returns {Promise<number>} Count of deleted sessions
 */
export async function invalidateAllUserSessions(userId) {
  if (!userId) return 0;
  return sessionStore.clearUserSessions(userId);
}
