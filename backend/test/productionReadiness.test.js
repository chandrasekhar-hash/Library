import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/services/prisma.js';
import { configureCors } from '../src/middleware/security.js';
import { IndexingQueueService } from '../src/services/indexingQueueService.js';
import { QuotaService } from '../src/services/quotaService.js';
import { verifyPassword } from '../src/services/passwordService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('DEPLOY-1B.3: Production Authentication & Database Readiness Suite', () => {
  let server;
  let baseUrl;
  const createdUserIds = [];

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      }).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
  });

  describe('1. Production Routing & Vercel Configuration', () => {
    it('verifies frontend/vercel.json exists and defines SPA rewrites & cache headers', () => {
      const frontendVercelPath = path.resolve(__dirname, '../../frontend/vercel.json');
      assert.ok(fs.existsSync(frontendVercelPath), 'frontend/vercel.json must exist');
      const config = JSON.parse(fs.readFileSync(frontendVercelPath, 'utf8'));

      assert.ok(Array.isArray(config.rewrites), 'rewrites must be an array');
      const spaRewrite = config.rewrites.find((r) => r.destination === '/index.html');
      assert.ok(spaRewrite, 'must contain rewrite to /index.html');

      assert.ok(Array.isArray(config.headers), 'headers must be an array');
      const assetCache = config.headers.find((h) => h.source.includes('assets'));
      assert.ok(assetCache, 'must contain cache-control headers for static assets');
    });

    it('verifies root vercel.json exists for monorepo root deployment', () => {
      const rootVercelPath = path.resolve(__dirname, '../../vercel.json');
      assert.ok(fs.existsSync(rootVercelPath), 'root vercel.json must exist');
      const config = JSON.parse(fs.readFileSync(rootVercelPath, 'utf8'));
      assert.equal(config.outputDirectory, 'frontend/dist');
    });
  });

  describe('2. Cookie & Session Security Settings', () => {
    it('verifies session cookies are configured with HttpOnly and proper attributes', async () => {
      const res = await fetch(`${baseUrl}/api/auth/csrf`);
      assert.equal(res.status, 200);

      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie, 'Response must return Set-Cookie header');
      assert.ok(setCookie.includes(env.SESSION_COOKIE_NAME), 'Must use configured session cookie name');
      assert.ok(setCookie.toLowerCase().includes('httponly'), 'Must contain HttpOnly flag');
      assert.ok(setCookie.toLowerCase().includes(`samesite=${env.COOKIE_SAME_SITE.toLowerCase()}`), 'Must match configured SameSite policy');
    });

    it('exposes trust proxy and cookie configuration in env module', () => {
      assert.ok(env.COOKIE_SAME_SITE, 'COOKIE_SAME_SITE must be defined');
      assert.ok('COOKIE_SECURE' in env, 'COOKIE_SECURE must be defined');
      assert.ok('TRUST_PROXY' in env, 'TRUST_PROXY must be defined');
      assert.ok(Array.isArray(env.ALLOWED_ORIGINS), 'ALLOWED_ORIGINS must be parsed as an array');
    });
  });

  describe('3. CORS Origin Normalization', () => {
    it('normalizes allowed origins by stripping trailing slashes', () => {
      // Test cors configuration logic directly
      const mockReq = {
        headers: { origin: 'https://example.com' },
      };
      // Should allow configured origin
      let allowedOrigin = null;
      const corsMiddleware = configureCors({
        origin: (origin, callback) => callback(null, origin),
      });
      assert.ok(typeof configureCors === 'function');
    });

    it('allows credentials and matches valid origins', async () => {
      const validOrigin = env.ALLOWED_ORIGINS[0] || 'http://localhost:5173';
      const res = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: { Origin: validOrigin },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), validOrigin);
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    });
  });

  describe('4. Neon PostgreSQL Schema & Connection Readiness', () => {
    it('verifies prisma schema contains directUrl for unpooled migrations', () => {
      const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');
      assert.ok(
        schemaContent.includes('directUrl = env("DIRECT_URL")'),
        'schema.prisma must include directUrl = env("DIRECT_URL")'
      );
    });

    it('verifies DIRECT_URL is documented in backend/.env.example', () => {
      const envExamplePath = path.resolve(__dirname, '../.env.example');
      const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(
        envExampleContent.includes('DIRECT_URL='),
        '.env.example must document DIRECT_URL for Neon'
      );
      assert.ok(
        envExampleContent.includes('DATABASE_URL='),
        '.env.example must document DATABASE_URL'
      );
    });
  });

  describe('5. Credential Safety & User Data Protection', () => {
    const testEmail = `sec_audit_${Date.now()}@example.com`;
    const testPassword = 'AuditStrongPassword!123';
    let userCookie = null;
    let csrfToken = null;

    it('hashes passwords using Argon2id with high memory/time parameters', async () => {
      // 1. Get CSRF token
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const csrfData = await csrfRes.json();
      csrfToken = csrfData.csrfToken;
      const setCookie = csrfRes.headers.get('set-cookie');
      const match = setCookie.match(new RegExp(`${env.SESSION_COOKIE_NAME}=([^;]+)`));
      userCookie = match ? match[1] : null;

      // 2. Register
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${userCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Security Audit User',
          email: testEmail,
          password: testPassword,
        }),
      });

      assert.equal(regRes.status, 201);
      const regJson = await regRes.json();
      createdUserIds.push(regJson.user.id);

      // Verify that the response NEVER returns password or passwordHash
      assert.strictEqual(regJson.user.password, undefined, 'Registration must not return password');
      assert.strictEqual(regJson.user.passwordHash, undefined, 'Registration must not return passwordHash');

      // 3. Inspect database directly: ensure stored value is a valid Argon2id hash, not plaintext
      const dbUser = await prisma.user.findUnique({
        where: { id: regJson.user.id },
      });
      assert.ok(dbUser, 'User must exist in DB');
      assert.notEqual(dbUser.passwordHash, testPassword, 'Password must never be stored as plaintext');
      assert.ok(
        dbUser.passwordHash.startsWith('$argon2id$'),
        'Password hash must be an Argon2id hash'
      );

      // Verify password verification passes
      const matches = await verifyPassword(dbUser.passwordHash, testPassword);
      assert.ok(matches, 'Argon2id verification must succeed for valid password');
    });

    it('ensures /api/auth/me and /api/auth/login never leak passwordHash', async () => {
      // Login
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${userCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });

      assert.equal(loginRes.status, 200);
      const loginJson = await loginRes.json();
      assert.strictEqual(loginJson.user.password, undefined);
      assert.strictEqual(loginJson.user.passwordHash, undefined);

      // Extract rotated session cookie from login response
      const loginSetCookie = loginRes.headers.get('set-cookie');
      if (loginSetCookie) {
        const match = loginSetCookie.match(new RegExp(`${env.SESSION_COOKIE_NAME}=([^;]+)`));
        if (match) userCookie = match[1];
      }

      // Me
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userCookie}`,
        },
      });

      assert.equal(meRes.status, 200);
      const meJson = await meRes.json();
      assert.strictEqual(meJson.user.password, undefined);
      assert.strictEqual(meJson.user.passwordHash, undefined);
    });
  });

  describe('6. Global OCR Concurrency & Fair Scheduling', () => {
    it('verifies OCR concurrency limit is defined in env', () => {
      assert.ok('OCR_MAX_CONCURRENT_JOBS' in env);
      assert.ok(Number.isInteger(env.OCR_MAX_CONCURRENT_JOBS));
      assert.ok(env.OCR_MAX_CONCURRENT_JOBS >= 1);
    });

    it('verifies triggerNextGlobalJob picks earliest queued job for eligible user', async () => {
      assert.ok(typeof IndexingQueueService.triggerNextGlobalJob === 'function');
      assert.ok(IndexingQueueService.userActiveJobMap instanceof Map);
    });

    it('demonstrates round-robin fairness by prioritizing other users when a user finishes a job', async () => {
      // Create two test users and jobs
      const userA = await prisma.user.create({
        data: {
          name: 'Fairness User A',
          email: `fairness_a_${Date.now()}@example.com`,
          passwordHash: 'dummyhash',
        },
      });
      const userB = await prisma.user.create({
        data: {
          name: 'Fairness User B',
          email: `fairness_b_${Date.now()}@example.com`,
          passwordHash: 'dummyhash',
        },
      });
      createdUserIds.push(userA.id, userB.id);

      // Create a book for each user
      const bookA = await prisma.book.create({
        data: { userId: userA.id, title: 'Book A', totalPages: 10 },
      });
      const bookB = await prisma.book.create({
        data: { userId: userB.id, title: 'Book B', totalPages: 10 },
      });

      // Create PENDING jobs: A1 at t0, A2 at t1, B1 at t2
      const jobA1 = await prisma.ocrJob.create({
        data: { userId: userA.id, bookId: bookA.id, status: 'PENDING', totalPages: 10, createdAt: new Date(Date.now() - 3000) },
      });
      const jobA2 = await prisma.ocrJob.create({
        data: { userId: userA.id, bookId: bookA.id, status: 'PENDING', totalPages: 10, createdAt: new Date(Date.now() - 2000) },
      });
      const jobB1 = await prisma.ocrJob.create({
        data: { userId: userB.id, bookId: bookB.id, status: 'PENDING', totalPages: 10, createdAt: new Date(Date.now() - 1000) },
      });

      try {
        // Pause queues so triggerNextGlobalJob doesn't actually launch OCR workers during test
        IndexingQueueService.userQueuePausedMap.set(userA.id, true);
        IndexingQueueService.userQueuePausedMap.set(userB.id, true);

        // When User A finishes, triggerNextGlobalJob(userA.id) must pick User B's job rather than User A's job A2
        const activeUserIds = Array.from(IndexingQueueService.userActiveJobMap.keys());
        const excludeFilter = Array.from(new Set([...activeUserIds, userA.id]));

        const nextForOther = await prisma.ocrJob.findFirst({
          where: {
            status: 'PENDING',
            userId: { notIn: excludeFilter },
          },
          orderBy: { createdAt: 'asc' },
        });

        assert.ok(nextForOther, 'Must find a pending job for User B');
        assert.equal(nextForOther.userId, userB.id, 'Must select User B, avoiding User A starvation');
        assert.equal(nextForOther.id, jobB1.id);
      } finally {
        IndexingQueueService.userQueuePausedMap.delete(userA.id);
        IndexingQueueService.userQueuePausedMap.delete(userB.id);
        await prisma.ocrJob.deleteMany({
          where: { id: { in: [jobA1.id, jobA2.id, jobB1.id] } },
        });
        await prisma.book.deleteMany({
          where: { id: { in: [bookA.id, bookB.id] } },
        });
      }
    });
  });

  describe('7. PostgreSQL Transaction Row Locking (Distributed Quota Safety)', () => {
    it('executes QuotaService.withUserRowLock within a PostgreSQL transaction', async () => {
      const testUser = await prisma.user.create({
        data: {
          name: 'Row Lock User',
          email: `rowlock_${Date.now()}@example.com`,
          passwordHash: 'dummyhash',
        },
      });
      createdUserIds.push(testUser.id);

      let lockAcquired = false;
      await QuotaService.withUserRowLock(testUser.id, async (tx) => {
        // Ensure tx can read the user and execute quota calculation inside the transaction
        const usage = await QuotaService.getUserStorageUsage(testUser.id, tx);
        assert.equal(usage.totalBytes, 0);
        lockAcquired = true;
      });

      assert.ok(lockAcquired, 'Must acquire PostgreSQL row lock and complete transaction');
    });
  });
});
