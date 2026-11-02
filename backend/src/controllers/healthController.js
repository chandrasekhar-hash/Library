import { checkDatabaseConnection } from '../config/database.js';
import { env } from '../config/env.js';

export async function getHealthStatus(req, res, next) {
  try {
    const dbStatus = await checkDatabaseConnection();

    const isHealthy = dbStatus.ok;
    const statusCode = isHealthy ? 200 : 503;

    return res.status(statusCode).json({
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'Aks Backend Service (अक्स)',
      tagline: 'A Reflection of You',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        connected: dbStatus.ok,
        databaseName: dbStatus.databaseName || null,
        latencyMs: dbStatus.latencyMs,
        ...(dbStatus.error ? { error: dbStatus.error } : {}),
      },
      environment: env.NODE_ENV,
    });
  } catch (error) {
    next(error);
  }
}
