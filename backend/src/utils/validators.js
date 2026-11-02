/**
 * Validation and normalization utilities for Aks (अक्स) Authentication.
 */

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Normalizes email address by trimming and converting to lowercase.
 *
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Validates registration input fields.
 *
 * Password requirements (sensible & secure):
 * - Length: 8 - 128 characters (protects against brute force while avoiding DoS via giant strings)
 * - Contains at least one lowercase letter
 * - Contains at least one uppercase letter
 * - Contains at least one numeric digit
 *
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.password
 * @returns {{ isValid: boolean, error?: string, normalizedEmail?: string, trimmedName?: string }}
 */
export function validateRegistrationInput({ name, email, password }) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { isValid: false, error: 'Full name is required.' };
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 100) {
    return { isValid: false, error: 'Full name must not exceed 100 characters.' };
  }

  const normalized = normalizeEmail(email);
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    return { isValid: false, error: 'Please provide a valid email address.' };
  }

  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'Password is required.' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long.' };
  }

  if (password.length > 128) {
    return { isValid: false, error: 'Password must not exceed 128 characters.' };
  }

  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one lowercase letter.' };
  }

  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one uppercase letter.' };
  }

  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one number.' };
  }

  return {
    isValid: true,
    trimmedName,
    normalizedEmail: normalized,
  };
}

/**
 * Validates login input fields.
 *
 * @param {Object} data
 * @param {string} data.email
 * @param {string} data.password
 * @returns {{ isValid: boolean, error?: string, normalizedEmail?: string }}
 */
export function validateLoginInput({ email, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized || typeof password !== 'string' || password.length === 0) {
    return { isValid: false, error: 'Email and password are required.' };
  }

  return {
    isValid: true,
    normalizedEmail: normalized,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a string is a valid UUID v4 format.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isValidUuid(id) {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * Supported annotation ribbon colors in Aks (अक्स)
 */
export const SUPPORTED_ANNOTATION_COLORS = ['gold', 'teal', 'emerald', 'amber', 'indigo', 'rose'];

/**
 * Validates and parses query parameters for pagination.
 *
 * @param {Object} query
 * @param {number} [defaultLimit=20]
 * @param {number} [maxLimit=100]
 * @returns {{ page: number, limit: number, skip: number }}
 */
export function parsePagination(query = {}, defaultLimit = 20, maxLimit = 100) {
  let page = parseInt(query.page, 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }

  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) {
    limit = defaultLimit;
  } else if (limit > maxLimit) {
    limit = maxLimit;
  }

  const skip = (page - 1) * limit;

  return { page, limit, skip };
}
