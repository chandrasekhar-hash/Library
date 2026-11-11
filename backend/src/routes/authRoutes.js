import { Router } from 'express';
import {
  register,
  login,
  logout,
  me,
  getStorageUsage,
  getCsrfToken,
  getGoogleAuthStatus,
  initiateGoogleAuth,
  handleGoogleCallback,
  verifyRecovery,
  resetPassword,
  updateProfile,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  registerRateLimiter,
  loginRateLimiter,
  recoveryRateLimiter,
} from '../middleware/rateLimiter.js';

const router = Router();

// CSRF Token retrieval
router.get('/csrf', getCsrfToken);

// Google OAuth 2.0 Integration
router.get('/google/status', getGoogleAuthStatus);
router.get('/google', initiateGoogleAuth);
router.get('/google/callback', handleGoogleCallback);

// Registration & Authentication
router.post('/register', registerRateLimiter, validateCsrf, register);
router.post('/login', loginRateLimiter, validateCsrf, login);
router.post('/logout', validateCsrf, logout);

// Password Recovery (Email + Mobile Number)
router.post('/recovery/verify', recoveryRateLimiter, validateCsrf, verifyRecovery);
router.post('/recovery/reset', recoveryRateLimiter, validateCsrf, resetPassword);

// User Profile Management
router.patch('/profile', requireAuth, validateCsrf, updateProfile);

// Current Authenticated User Identity & Storage Quota
router.get('/me', requireAuth, me);
router.get('/storage', requireAuth, getStorageUsage);

export default router;
