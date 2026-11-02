import argon2 from 'argon2';

/**
 * Password Security Service for Aks (अक्स)
 * Implements Argon2id with strict parameters specified in the security specification:
 * - Algorithm: Argon2id (type 2)
 * - Memory cost: 65536 KiB (64 MiB)
 * - Time cost: 3 iterations
 * - Parallelism: 1 thread
 */

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

/**
 * Hash a plaintext password using Argon2id.
 * Never logs passwords or generated hashes.
 *
 * @param {string} password - Plaintext password
 * @returns {Promise<string>} Argon2id password hash string
 */
export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }

  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against an Argon2id hash.
 * Never logs passwords or hashes.
 *
 * @param {string} hash - Argon2id hash from database
 * @param {string} password - Plaintext password provided by user
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
export async function verifyPassword(hash, password) {
  if (!hash || !password || typeof hash !== 'string' || typeof password !== 'string') {
    return false;
  }

  try {
    return await argon2.verify(hash, password);
  } catch {
    // If hash format is invalid or verification encounters an internal error, fail closed
    return false;
  }
}
