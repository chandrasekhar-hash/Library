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
 * Normalizes a mobile number:
 * - Strips all whitespace, dashes, parentheses, dots.
 * - Handles leading '00' as '+'.
 * - If 11 digits starting with 0, strips 0 and prepends '+91'.
 * - If 10 digits starting with [6-9], prepends '+91' (standard Indian mobile format).
 * - If already starts with '+', preserves '+' followed by clean digits.
 *
 * @param {string} mobileNumber
 * @returns {string} Normalized mobile number string
 */
export function normalizeMobileNumber(mobileNumber) {
  if (typeof mobileNumber !== 'string') return '';
  let cleaned = mobileNumber.trim().replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    cleaned = '+91' + cleaned.slice(1);
  } else if (/^[6-9]\d{9}$/.test(cleaned)) {
    cleaned = '+91' + cleaned;
  }
  return cleaned;
}

/**
 * Validates mobile number format.
 * Accepts ITU-T E.164 format (+[1-9] followed by 7-14 digits) or standard 10-digit numbers.
 *
 * @param {string} mobileNumber
 * @returns {{ isValid: boolean, error?: string, normalizedNumber?: string }}
 */
export function validateMobileNumber(mobileNumber) {
  if (!mobileNumber || typeof mobileNumber !== 'string' || mobileNumber.trim().length === 0) {
    return { isValid: false, error: 'Mobile number is required.' };
  }

  const normalized = normalizeMobileNumber(mobileNumber);
  const E164_REGEX = /^\+[1-9]\d{7,14}$/;

  if (!E164_REGEX.test(normalized)) {
    return {
      isValid: false,
      error: 'Please provide a valid mobile number (e.g. +91 98765 43210 or 10-digit mobile number).',
    };
  }

  return {
    isValid: true,
    normalizedNumber: normalized,
  };
}

/**
 * Masks a mobile number for safe display (e.g. "+91 ******4210").
 * Never exposes the full mobile number.
 *
 * @param {string} mobileNumber
 * @returns {string|null}
 */
export function maskMobileNumber(mobileNumber) {
  if (!mobileNumber || typeof mobileNumber !== 'string') return null;
  const normalized = normalizeMobileNumber(mobileNumber);
  if (normalized.length < 6) return '******';
  const last4 = normalized.slice(-4);
  const prefix = normalized.slice(0, 3);
  return `${prefix} ******${last4}`;
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
 * Mobile number requirements:
 * - If provided, strictly validated against E.164 format.
 *
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.password
 * @param {string} [data.mobileNumber]
 * @returns {{ isValid: boolean, error?: string, normalizedEmail?: string, trimmedName?: string, normalizedMobileNumber?: string|null }}
 */
export function validateRegistrationInput({ name, email, password, mobileNumber }) {
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

  let normalizedMobileNumber = null;
  if (mobileNumber !== undefined && mobileNumber !== null && String(mobileNumber).trim() !== '') {
    const mobileValidation = validateMobileNumber(mobileNumber);
    if (!mobileValidation.isValid) {
      return { isValid: false, error: mobileValidation.error };
    }
    normalizedMobileNumber = mobileValidation.normalizedNumber;
  }

  return {
    isValid: true,
    trimmedName,
    normalizedEmail: normalized,
    normalizedMobileNumber,
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
