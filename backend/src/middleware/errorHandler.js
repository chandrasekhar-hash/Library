import { env } from '../config/env.js';

/**
 * Centralized HTTP error handler middleware.
 * Ensures internal database errors, stack traces, and sensitive details
 * are not leaked to API clients in production.
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  console.error(`[Error] ${req.method} ${req.url} - ${statusCode}:`, err.message);

  if (!env.IS_PRODUCTION && err.stack) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: {
      message: err.isOperational || !env.IS_PRODUCTION ? err.message : 'An unexpected error occurred.',
      code: err.code || 'INTERNAL_SERVER_ERROR',
      ...(env.IS_PRODUCTION ? {} : { stack: err.stack }),
    },
  });
}

/**
 * 404 Route Not Found middleware
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.method} ${req.originalUrl} not found on this server.`,
      code: 'ROUTE_NOT_FOUND',
    },
  });
}
