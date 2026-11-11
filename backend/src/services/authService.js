import crypto from 'crypto';
import { prisma } from './prisma.js';
import { hashPassword, verifyPassword } from './passwordService.js';
import {
  normalizeEmail,
  normalizeMobileNumber,
  validateMobileNumber,
  maskMobileNumber,
  validateRegistrationInput,
  validateLoginInput,
} from '../utils/validators.js';
import { sessionStore } from './sessionStore.js';
import { DEFAULT_USER_PREFERENCES } from '../config/preferences.js';

/**
 * Register a new user account.
 *
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.mobileNumber]
 * @returns {Promise<{ user: Object }>}
 */
export async function registerUser({ name, email, password, mobileNumber }) {
  const validation = validateRegistrationInput({ name, email, password, mobileNumber });
  if (!validation.isValid) {
    const error = new Error(validation.error);
    error.status = 400;
    error.code = 'INVALID_REGISTRATION_INPUT';
    throw error;
  }

  const { trimmedName, normalizedEmail, normalizedMobileNumber } = validation;

  // Hash password using Argon2id with strict security parameters
  const passwordHash = await hashPassword(password);

  try {
    // Atomically create user and default preferences with strict USER role
    const newUser = await prisma.user.create({
      data: {
        name: trimmedName,
        email: normalizedEmail,
        passwordHash,
        role: 'USER',
        mobileNumber: normalizedMobileNumber || null,
        preference: {
          create: DEFAULT_USER_PREFERENCES,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobileNumber: true,
        createdAt: true,
      },
    });

    return { user: newUser };
  } catch (err) {
    // Handle Prisma unique constraint violation (P2002 on User.email or lower(email))
    const isEmailConflict =
      err.code === 'P2002' &&
      (err.meta?.target?.includes('email') ||
        err.meta?.target?.some?.((t) => typeof t === 'string' && t.toLowerCase().includes('email')));

    if (isEmailConflict) {
      const conflictError = new Error('An account with this email address already exists.');
      conflictError.status = 409;
      conflictError.code = 'EMAIL_ALREADY_EXISTS';
      throw conflictError;
    }

    // Handle Prisma unique constraint violation on mobileNumber
    const isMobileConflict =
      err.code === 'P2002' &&
      (err.meta?.target?.includes('mobileNumber') ||
        err.meta?.target?.some?.((t) => typeof t === 'string' && t.toLowerCase().includes('mobilenumber')));

    if (isMobileConflict) {
      const conflictError = new Error('An account with this mobile number already exists.');
      conflictError.status = 409;
      conflictError.code = 'MOBILE_ALREADY_EXISTS';
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

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mobileNumber: true,
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
    role: user.role,
    mobileNumber: user.mobileNumber,
    createdAt: user.createdAt,
  };
}

/**
 * Initiates password recovery using email + mobile number.
 * Both must belong to the exact same registered account.
 * To prevent account enumeration, timings are equalized and generic errors are returned.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.mobileNumber
 * @returns {Promise<{ recoveryToken: string, expiresAt: Date }>}
 */
export async function verifyRecoveryCredentials({ email, mobileNumber }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedMobile = normalizeMobileNumber(mobileNumber);

  if (!normalizedEmail || !normalizedMobile) {
    // Perform dummy verify to equalize timing
    await verifyPassword(
      '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$c29tZXNhbHQ',
      'dummy_timing_probe_string'
    );
    const err = new Error('The provided email and mobile number combination could not be verified.');
    err.status = 400;
    err.code = 'INVALID_RECOVERY_CREDENTIALS';
    throw err;
  }

  // Look up user by email (case-insensitive)
  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      email: true,
      mobileNumber: true,
      passwordHash: true,
    },
  });

  // Strict check: User must exist, must have a mobile number registered, and it must match exactly
  const isMatch = Boolean(
    user &&
    user.mobileNumber &&
    user.mobileNumber === normalizedMobile
  );

  if (!isMatch) {
    // Perform dummy verify against real user hash or static hash to equalize timing
    await verifyPassword(
      user?.passwordHash || '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$c29tZXNhbHQ',
      'dummy_timing_probe_string'
    );
    const err = new Error('The provided email and mobile number combination could not be verified.');
    err.status = 400;
    err.code = 'INVALID_RECOVERY_CREDENTIALS';
    throw err;
  }

  // Credentials match!
  // Invalidate any previously active unused tokens for this user
  await prisma.passwordRecoveryToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  // Generate 256-bit cryptographically secure random token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lifetime

  // Store only the SHA-256 hash in database
  await prisma.passwordRecoveryToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  return {
    recoveryToken: rawToken,
    expiresAt,
  };
}

/**
 * Resets user password using a verified recovery token.
 * Token must be valid, not expired, and not previously consumed.
 * Consumed atomically in a PostgreSQL transaction.
 * All existing sessions for the account are revoked.
 *
 * @param {Object} params
 * @param {string} params.recoveryToken
 * @param {string} params.newPassword
 * @param {string} params.confirmPassword
 * @returns {Promise<{ success: boolean }>}
 */
export async function resetPasswordWithToken({ recoveryToken, newPassword, confirmPassword }) {
  if (!recoveryToken || typeof recoveryToken !== 'string') {
    const err = new Error('Recovery authorization token is required.');
    err.status = 400;
    err.code = 'MISSING_RECOVERY_TOKEN';
    throw err;
  }

  if (newPassword !== confirmPassword) {
    const err = new Error('New password and confirmation password do not match.');
    err.status = 400;
    err.code = 'PASSWORD_MISMATCH';
    throw err;
  }

  // Validate new password rules
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    const err = new Error('Password must be at least 8 characters long.');
    err.status = 400;
    err.code = 'INVALID_PASSWORD';
    throw err;
  }
  if (newPassword.length > 128) {
    const err = new Error('Password must not exceed 128 characters.');
    err.status = 400;
    err.code = 'INVALID_PASSWORD';
    throw err;
  }
  if (!/[a-z]/.test(newPassword)) {
    const err = new Error('Password must contain at least one lowercase letter.');
    err.status = 400;
    err.code = 'INVALID_PASSWORD';
    throw err;
  }
  if (!/[A-Z]/.test(newPassword)) {
    const err = new Error('Password must contain at least one uppercase letter.');
    err.status = 400;
    err.code = 'INVALID_PASSWORD';
    throw err;
  }
  if (!/[0-9]/.test(newPassword)) {
    const err = new Error('Password must contain at least one number.');
    err.status = 400;
    err.code = 'INVALID_PASSWORD';
    throw err;
  }

  // Compute token hash
  const tokenHash = crypto.createHash('sha256').update(recoveryToken).digest('hex');
  const now = new Date();

  // Find token record
  const tokenRecord = await prisma.passwordRecoveryToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!tokenRecord || tokenRecord.usedAt !== null || tokenRecord.expiresAt < now) {
    const err = new Error('Invalid or expired recovery authorization. Please start recovery again.');
    err.status = 400;
    err.code = 'INVALID_OR_EXPIRED_TOKEN';
    throw err;
  }

  // Hash new password using Argon2id
  const newPasswordHash = await hashPassword(newPassword);

  // Execute atomically in a PostgreSQL transaction
  await prisma.$transaction(async (tx) => {
    // 1. Consume token atomically (optimistic check on usedAt: null)
    const updateResult = await tx.passwordRecoveryToken.updateMany({
      where: {
        id: tokenRecord.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        usedAt: now,
      },
    });

    if (updateResult.count === 0) {
      const err = new Error('Recovery authorization has already been used or expired.');
      err.status = 400;
      err.code = 'TOKEN_ALREADY_USED';
      throw err;
    }

    // 2. Update user's password
    await tx.user.update({
      where: { id: tokenRecord.userId },
      data: {
        passwordHash: newPasswordHash,
      },
    });

    // 3. Invalidate ALL existing active sessions for this account across PostgreSQL
    await tx.session.deleteMany({
      where: { userId: tokenRecord.userId },
    });
  });

  return { success: true };
}

/**
 * Updates an authenticated user's profile (e.g. mobile number).
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.mobileNumber
 * @returns {Promise<{ user: Object }>}
 */
export async function updateUserProfile({ userId, mobileNumber }) {
  if (!userId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    err.code = 'UNAUTHENTICATED';
    throw err;
  }

  const mobileValidation = validateMobileNumber(mobileNumber);
  if (!mobileValidation.isValid) {
    const err = new Error(mobileValidation.error);
    err.status = 400;
    err.code = 'INVALID_MOBILE_NUMBER';
    throw err;
  }

  const normalizedMobile = mobileValidation.normalizedNumber;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        mobileNumber: normalizedMobile,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobileNumber: true,
        createdAt: true,
      },
    });

    return {
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        hasMobileNumber: true,
        mobileNumberMasked: maskMobileNumber(updatedUser.mobileNumber),
        createdAt: updatedUser.createdAt,
      },
    };
  } catch (err) {
    if (err.code === 'P2002') {
      const conflictError = new Error('An account with this mobile number already exists.');
      conflictError.status = 409;
      conflictError.code = 'MOBILE_ALREADY_EXISTS';
      throw conflictError;
    }
    throw err;
  }
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
