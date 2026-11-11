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
  if (val === 'true') return 1;
  if (val === 'false') return false;
  const num = Number(val);
  if (!Number.isNaN(num)) return num;
  return val;
};

const parseAllowedOrigins = (frontendUrl, isProd) => {
  if (frontendUrl) {
    return Array.from(
      new Set(
        frontendUrl
          .split(',')
          .map((url) => url.trim().replace(/\/$/, ''))
          .filter(Boolean)
      )
    );
  }
  // In development, support Vite alternate ports when 5173 is occupied
  if (!isProd) {
    return [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
    ];
  }
  return ['http://localhost:5173'];
};

export const env = {
  PORT: parseInt(process.env.PORT || '5050', 10),
  NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  ALLOWED_ORIGINS: parseAllowedOrigins(process.env.FRONTEND_URL, IS_PRODUCTION),
  DATABASE_URL: process.env.DATABASE_URL || '',
  DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  SESSION_SECRET: process.env.SESSION_SECRET || 'aks_sanctuary_dev_session_secret_2026_at_least_32_chars_long',
  STORAGE_ROOT: path.resolve(__dirname, '../../', process.env.STORAGE_ROOT || './storage'),
  MAX_UPLOAD_SIZE_MB: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '150', 10),
  IS_PRODUCTION,
  SESSION_COOKIE_NAME: 'aks.sid',
  COOKIE_SAME_SITE: (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase(),
  COOKIE_SECURE: process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : IS_PRODUCTION,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || undefined,
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY, IS_PRODUCTION),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${process.env.PORT || '5050'}/api/auth/google/callback`,
  IS_GOOGLE_OAUTH_CONFIGURED: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  // Storage Provider (local | r2)
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || 'local',
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || 'aks-storage',
  R2_ENDPOINT: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
  // Internal Python OCR Engine Integration
  OCR_WORKER_URL: process.env.OCR_WORKER_URL || 'http://127.0.0.1:5060',
  OCR_WORKER_TOKEN: process.env.OCR_WORKER_TOKEN || process.env.AKS_OCR_SECRET_KEY || 'aks-internal-dev-token',
  OCR_WORKER_TIMEOUT_MS: parseInt(process.env.OCR_WORKER_TIMEOUT_MS || '300000', 10),
  OCR_MAX_CONCURRENT_JOBS: parseInt(process.env.OCR_MAX_CONCURRENT_JOBS || '1', 10),
  // Multi-User Resource Protection: Storage Quotas
  MAX_USER_STORAGE_BYTES: parseInt(process.env.MAX_USER_STORAGE_BYTES || String(250 * 1024 * 1024), 10), // 250 MB
  MAX_PDF_SIZE_BYTES: parseInt(process.env.MAX_PDF_SIZE_BYTES || String(150 * 1024 * 1024), 10), // 150 MB
  MAX_COVER_SIZE_BYTES: parseInt(process.env.MAX_COVER_SIZE_BYTES || String(5 * 1024 * 1024), 10), // 5 MB
  MAX_ASSET_SIZE_BYTES: parseInt(process.env.MAX_ASSET_SIZE_BYTES || String(50 * 1024 * 1024), 10), // 50 MB
  // Multi-User Resource Protection: Rate Limits
  UPLOAD_RATE_LIMIT_WINDOW_MS: parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10), // 15m
  UPLOAD_RATE_LIMIT_MAX: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || '30', 10), // 30 uploads
  SEARCH_RATE_LIMIT_WINDOW_MS: parseInt(process.env.SEARCH_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10), // 1m
  SEARCH_RATE_LIMIT_MAX: parseInt(process.env.SEARCH_RATE_LIMIT_MAX || '60', 10), // 60 searches
  OCR_DISPATCH_RATE_LIMIT_WINDOW_MS: parseInt(process.env.OCR_DISPATCH_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10), // 15m
  OCR_DISPATCH_RATE_LIMIT_MAX: parseInt(process.env.OCR_DISPATCH_RATE_LIMIT_MAX || '20', 10), // 20 dispatches
  // Multi-User Resource Protection: OCR Safeguards
  MAX_OCR_PAGE_COUNT: parseInt(process.env.MAX_OCR_PAGE_COUNT || '2000', 10), // 2,000 pages
  MAX_QUEUED_OCR_JOBS_PER_USER: parseInt(process.env.MAX_QUEUED_OCR_JOBS_PER_USER || '10', 10), // 10 queued jobs
};

