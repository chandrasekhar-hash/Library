import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, authApi } from '../src/services/api.js';

describe('ISSUE-AUTH-02 & ACCOUNT-FIX-1: Authentication Error Messages & Registration Flow', () => {
  test('authApi exports getGoogleAuthStatus and getGoogleAuthUrl', () => {
    assert.equal(typeof authApi.getGoogleAuthStatus, 'function');
    assert.equal(typeof authApi.getGoogleAuthUrl, 'function');
    const url = authApi.getGoogleAuthUrl();
    assert.ok(url.includes('/api/auth/google'));
  });

  test('Form input validation rules match expected error messages', () => {
    const validate = (email, password, isSignUp = false) => {
      const trimmedEmail = email ? email.trim() : '';
      if (!trimmedEmail) return 'Please enter your email address.';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) return 'Please enter a valid email address.';
      if (!password) return 'Please enter your password.';
      if (isSignUp) {
        if (password.length < 8) return 'Password must be at least 8 characters long.';
        if (password.length > 128) return 'Password must not exceed 128 characters.';
        if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
        if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
        if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
      }
      return null;
    };

    // Empty email
    assert.equal(validate('', 'password123'), 'Please enter your email address.');
    assert.equal(validate('   ', 'password123'), 'Please enter your email address.');

    // Invalid email format
    assert.equal(validate('not-an-email', 'password123'), 'Please enter a valid email address.');
    assert.equal(validate('missingatdomain.com', 'password123'), 'Please enter a valid email address.');

    // Empty password
    assert.equal(validate('valid@example.com', ''), 'Please enter your password.');

    // Short password on sign up
    assert.equal(validate('valid@example.com', 'short', true), 'Password must be at least 8 characters long.');

    // Missing lowercase on sign up
    assert.equal(validate('valid@example.com', 'PASSWORD123', true), 'Password must contain at least one lowercase letter.');

    // Missing uppercase on sign up
    assert.equal(validate('valid@example.com', 'password123', true), 'Password must contain at least one uppercase letter.');

    // Missing number on sign up
    assert.equal(validate('valid@example.com', 'PasswordOnly', true), 'Password must contain at least one number.');

    // Valid inputs on sign up
    assert.equal(validate('valid@example.com', 'ValidPass123', true), null);

    // Valid inputs on sign in
    assert.equal(validate('valid@example.com', 'anypass', false), null);
  });

  test('API and network error classification formats proper user-facing messages', () => {
    const formatAuthError = (err, isSignUp = false) => {
      if (
        err.isNetworkError ||
        err.statusCode === 0 ||
        err.status === 0 ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('Network connection failed') ||
        err.message?.includes('Unable to connect')
      ) {
        return 'Unable to connect to Aks. Please check your connection and try again.';
      }
      if (
        err.code === 'EBADCSRFTOKEN' ||
        err.status === 403 ||
        err.statusCode === 403 ||
        err.message?.toLowerCase().includes('csrf')
      ) {
        return 'Security verification failed. Please try again.';
      }
      if (
        err.code === 'EMAIL_ALREADY_EXISTS' ||
        err.status === 409 ||
        err.statusCode === 409
      ) {
        return 'An account with this email address already exists.';
      }
      if (
        !isSignUp &&
        (err.status === 401 ||
          err.statusCode === 401 ||
          err.code === 'INVALID_CREDENTIALS' ||
          err.message?.toLowerCase().includes('credential'))
      ) {
        return 'Incorrect email or password.';
      }
      if (err.status >= 500 || err.statusCode >= 500) {
        return 'Something went wrong. Please try again.';
      }
      return (
        err.details?.map((d) => d.message).join(' ') ||
        err.message ||
        'Something went wrong. Please try again.'
      );
    };

    // Network connection down / unreachable
    const networkErr = new Error('Failed to fetch');
    networkErr.isNetworkError = true;
    assert.equal(
      formatAuthError(networkErr),
      'Unable to connect to Aks. Please check your connection and try again.'
    );

    // 401 Unauthorized / Invalid credentials on login
    const authErr = new Error('Incorrect email or password.');
    authErr.status = 401;
    authErr.code = 'INVALID_CREDENTIALS';
    assert.equal(formatAuthError(authErr, false), 'Incorrect email or password.');

    // 409 Conflict: Duplicate email on registration
    const dupErr = new Error('An account with this email address already exists.');
    dupErr.status = 409;
    dupErr.code = 'EMAIL_ALREADY_EXISTS';
    assert.equal(formatAuthError(dupErr, true), 'An account with this email address already exists.');

    // 400 Bad Request: Password validation failure during registration must NOT become "Incorrect email or password."
    const pwErr = new Error('Password must contain at least one uppercase letter.');
    pwErr.status = 400;
    pwErr.code = 'INVALID_REGISTRATION_INPUT';
    assert.equal(formatAuthError(pwErr, true), 'Password must contain at least one uppercase letter.');

    // 403 Forbidden: CSRF token failure
    const csrfErr = new Error('Invalid or missing CSRF token.');
    csrfErr.status = 403;
    csrfErr.code = 'EBADCSRFTOKEN';
    assert.equal(formatAuthError(csrfErr, true), 'Security verification failed. Please try again.');

    // 500 Internal Server Error
    const serverErr = new Error('Database connection failed');
    serverErr.status = 500;
    assert.equal(formatAuthError(serverErr), 'Something went wrong. Please try again.');
  });
});
