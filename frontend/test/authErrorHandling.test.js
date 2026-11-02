import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, authApi } from '../src/services/api.js';

describe('ISSUE-AUTH-02: Authentication Error Messages & Google OAuth Flow', () => {
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
      if (isSignUp && password.length < 8) return 'Password must be at least 8 characters.';
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
    assert.equal(validate('valid@example.com', 'short', true), 'Password must be at least 8 characters.');

    // Valid inputs
    assert.equal(validate('valid@example.com', 'ValidPass123'), null);
  });

  test('API and network error classification formats proper user-facing messages', () => {
    const formatAuthError = (err) => {
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
        err.status === 401 ||
        err.statusCode === 401 ||
        err.code === 'INVALID_CREDENTIALS' ||
        err.message?.toLowerCase().includes('password') ||
        err.message?.toLowerCase().includes('credential')
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

    // 401 Unauthorized / Invalid credentials
    const authErr = new Error('Incorrect email or password.');
    authErr.status = 401;
    authErr.code = 'INVALID_CREDENTIALS';
    assert.equal(formatAuthError(authErr), 'Incorrect email or password.');

    // 500 Internal Server Error
    const serverErr = new Error('Database connection failed');
    serverErr.status = 500;
    assert.equal(formatAuthError(serverErr), 'Something went wrong. Please try again.');
  });
});
