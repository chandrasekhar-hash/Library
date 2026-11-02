import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';

export function configureSecurityHeaders() {
  return helmet({
    contentSecurityPolicy: false, // Managed by Vite in dev
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Only apply Strict-Transport-Security in production over HTTPS; disabled on localhost HTTP
    hsts: env.IS_PRODUCTION
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
  });
}

export function configureCors() {
  const allowedOrigins = [env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'];

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, curl, or same-origin)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not permitted by Aks CORS policy.`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Range',
      'X-Requested-With',
      'X-CSRF-Token',
      'x-csrf-token',
      'X-XSRF-Token',
      'x-xsrf-token',
      'Idempotency-Key',
      'idempotency-key',
    ],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
    maxAge: 86400, // 24 hours preflight cache
  });
}
