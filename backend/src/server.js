import app from './app.js';
import { env } from './config/env.js';
import { initStorage } from './config/storage.js';
import { checkDatabaseConnection } from './config/database.js';
import { prisma } from './services/prisma.js';
import { startSessionPruning } from './middleware/session.js';
import { OcrJobService } from './services/ocrJobService.js';

async function bootstrap() {
  console.log('─────────────────────────────────────────────────────────────');
  console.log('  Aks (अक्स) — A Reflection of You Backend Service');
  console.log('─────────────────────────────────────────────────────────────');

  // 1. Initialize private storage directories
  initStorage();
  console.log(`[Storage] Private storage directory initialized at: ${env.STORAGE_ROOT}`);

  // 2. Verify PostgreSQL connection
  console.log('[Database] Checking PostgreSQL connection...');
  const dbStatus = await checkDatabaseConnection();

  if (dbStatus.ok) {
    console.log(`[Database] Successfully connected to PostgreSQL database: "${dbStatus.databaseName}" (${dbStatus.latencyMs}ms)`);
  } else {
    console.error(`[Database Error] Connection failed: ${dbStatus.error}`);
    console.warn('[Database Warning] Server will start, but database operations will fail until connection is resolved.');
  }

  // 3. Initialize background session pruning
  startSessionPruning();

  // 4. Recover any interrupted OCR jobs
  OcrJobService.recoverDanglingJobs().catch((err) => {
    console.error('[OCR] Error recovering dangling OCR jobs:', err);
  });

  // 5. Start HTTP server
  const server = app.listen(env.PORT, () => {
    console.log(`[Server] Aks Backend running on http://localhost:${env.PORT}`);
    console.log(`[Server] Health check available at: http://localhost:${env.PORT}/api/health`);
    console.log(`[Server] Allowed Frontend Origin: ${env.FRONTEND_URL}`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      try {
        await prisma.$disconnect();
        console.log('[Database] Disconnected Prisma client.');
      } catch (err) {
        console.error('[Database Error] Error during Prisma disconnect:', err);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Fatal Error] Failed to boot Aks server:', err);
  process.exit(1);
});
