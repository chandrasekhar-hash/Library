import { prisma } from '../services/prisma.js';

/**
 * Verifies PostgreSQL connectivity using Prisma.
 * @returns {Promise<{ ok: boolean, databaseName?: string, latencyMs?: number, error?: string }>}
 */
export async function checkDatabaseConnection() {
  const start = Date.now();
  try {
    const result = await prisma.$queryRaw`SELECT current_database() as db_name, 1 as check;`;
    const latencyMs = Date.now() - start;
    const dbName = Array.isArray(result) && result[0]?.db_name ? result[0].db_name : 'unknown';
    return {
      ok: true,
      databaseName: dbName,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    console.error('[PostgreSQL Error] Database connection check failed:', error.message);
    return {
      ok: false,
      latencyMs,
      error: 'Could not connect to PostgreSQL database. Please ensure PostgreSQL service is active and DATABASE_URL is valid.',
    };
  }
}
