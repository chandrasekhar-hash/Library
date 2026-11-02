import { Router } from 'express';
import {
  register,
  login,
  logout,
  me,
  getCsrfToken,
  getGoogleAuthStatus,
  initiateGoogleAuth,
  handleGoogleCallback,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { registerRateLimiter, loginRateLimiter } from '../middleware/rateLimiter.js';

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

// Current Authenticated User Identity
router.get('/me', requireAuth, me);

export default router;
