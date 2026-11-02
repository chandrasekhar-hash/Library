import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Validate critical environment configurations
if (!process.env.DATABASE_URL) {
  if (IS_PRODUCTION) {
    throw new Error('[Fatal Error] DATABASE_URL must be defined in production environment.');
  } else {
    console.warn('[Config Warning] DATABASE_URL is not set in environment.');
  }
}

if (IS_PRODUCTION) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error(
      '[Fatal Error] In production, SESSION_SECRET must be set to a cryptographically secure random string of at least 32 characters.'
    );
  }
}

const parseTrustProxy = (val, isProd) => {
  if (val === undefined || val === '') {
    return isProd ? 1 : false;
  }
  if (val === 'true') return true;
  if (val === 'false') return false;
  const num = Number(val);
  if (!Number.isNaN(num)) return num;
  return val;
};

export const env = {
  PORT: parseInt(process.env.PORT || '5050', 10),
  NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL || '',
  SESSION_SECRET: process.env.SESSION_SECRET || 'aks_sanctuary_dev_session_secret_2026_at_least_32_chars_long',
  STORAGE_ROOT: path.resolve(__dirname, '../../', process.env.STORAGE_ROOT || './storage'),
  MAX_UPLOAD_SIZE_MB: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '150', 10),
  IS_PRODUCTION,
  SESSION_COOKIE_NAME: 'aks.sid',
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY, IS_PRODUCTION),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${process.env.PORT || '5050'}/api/auth/google/callback`,
  IS_GOOGLE_OAUTH_CONFIGURED: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  // Internal Python OCR Engine Integration
  OCR_WORKER_URL: process.env.OCR_WORKER_URL || 'http://127.0.0.1:5060',
  OCR_WORKER_TOKEN: process.env.OCR_WORKER_TOKEN || process.env.AKS_OCR_SECRET_KEY || 'aks-internal-dev-token',
  OCR_WORKER_TIMEOUT_MS: parseInt(process.env.OCR_WORKER_TIMEOUT_MS || '300000', 10),
  OCR_MAX_CONCURRENT_JOBS: parseInt(process.env.OCR_MAX_CONCURRENT_JOBS || '1', 10),
};

