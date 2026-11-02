/**
 * Library-Wide Indexing System Test Suite for Aks (अक्स)
 * Phase OCR-4B: Universal Indexing, Sequential Persistent Queue & Multi-Tenant Isolation
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths } from '../src/config/storage.js';
import { ocrClient } from '../src/services/ocrClient.js';
import { IndexingQueueService } from '../src/services/indexingQueueService.js';
import { OcrJobService } from '../src/services/ocrJobService.js';
import { assertTestResource } from '../src/utils/testDatabaseGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Aks — Phase OCR-4B: Library-Wide Indexing & Sequential Queue Suite', () => {
  let server;
  let baseUrl;
  let mockWorkerServer;
  let mockWorkerUrl;

  const testUserIds = [];
  const testBookIds = [];
  const createdPhysicalFiles = [];

  let mockWorkerCallCount = 0;

  before(async () => {
    // 1. Start main Aks Express server on ephemeral port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // 2. Start mock Python OCR Worker on ephemeral port
    mockWorkerServer = http.createServer((req, res) => {
      mockWorkerCallCount++;
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'healthy', active_workers: 0, normalizer_version: '1.0.0' }));
      }
      if (req.url === '/ocr/pdf' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          pages: [
            {
              page: 0,
              lines: [{ text: 'Sample Scanned Line', confidence: 0.98, bbox: [[10, 10], [100, 10], [100, 30], [10, 30]] }],
              line_count: 1,
              average_confidence: 0.98,
              width: 600,
              height: 800,
            },
          ],
        }));
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => mockWorkerServer.listen(0, resolve));
    const workerPort = mockWorkerServer.address().port;
    mockWorkerUrl = `http://127.0.0.1:${workerPort}`;

    ocrClient.baseUrl = mockWorkerUrl;
  });

  after(async () => {
    // Wait for any active jobs to finish
    await new Promise((r) => setTimeout(r, 600));

    // Clean up DB records for tracked test IDs only
    if (testBookIds.length > 0) {
      assertTestResource(testBookIds[0], testBookIds, 'book');
      await prisma.bookPageOcr.deleteMany({ where: { bookId: { in: testBookIds } } });
      await prisma.ocrJob.deleteMany({ where: { bookId: { in: testBookIds } } });
      await prisma.bookFile.deleteMany({ where: { bookId: { in: testBookIds } } });
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }

    if (testUserIds.length > 0) {
      assertTestResource(testUserIds[0], testUserIds, 'user');
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }

    // Clean up created files
    for (const f of createdPhysicalFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (_) {}
    }

    if (server) await new Promise((res) => server.close(res));
    if (mockWorkerServer) await new Promise((res) => mockWorkerServer.close(res));
  });

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  async function createAuthenticatedUser(name, email, password) {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const anonCookie = extractCookie(csrfRes);
    const { csrfToken: regCsrf } = await csrfRes.json();

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': regCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
      },
      body: JSON.stringify({ name, email, password }),
    });

    const regData = await regRes.json();
    const userId = regData.user.id;
    testUserIds.push(userId);

    const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const { csrfToken: loginCsrf } = await loginCsrfRes.json();
    const loginCookie = extractCookie(loginCsrfRes);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': loginCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${loginCookie}`,
      },
      body: JSON.stringify({ email, password }),
    });

    const authCookie = extractCookie(loginRes);

    const authCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    const { csrfToken } = await authCsrfRes.json();

    return {
      userId,
      cookie: authCookie,
      csrfToken,
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'x-csrf-token': csrfToken,
      },
    };
  }

  async function createTestBookWithPhysicalPdf(user, title, textContent = 'The comprehensive philosophical and scientific discourse on universal consciousness.') {
    const bookRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, totalPages: 1 }),
    });
    const { book } = await bookRes.json();
    testBookIds.push(book.id);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    if (textContent) {
      page.drawText(textContent, { x: 50, y: 700, size: 14 });
    }
    const pdfBytes = await pdfDoc.save();

    const storageSubdir = path.join(storagePaths.pdfs, user.userId);
    if (!fs.existsSync(storageSubdir)) {
      fs.mkdirSync(storageSubdir, { recursive: true });
    }
    const relativePath = `pdfs/${user.userId}/${book.id}.pdf`;
    const fullPath = path.join(env.STORAGE_ROOT, relativePath);
    fs.writeFileSync(fullPath, Buffer.from(pdfBytes));
    createdPhysicalFiles.push(fullPath);

    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        storagePath: relativePath,
        filename: `${title.replace(/\s+/g, '_')}.pdf`,
        fileSizeBytes: BigInt(pdfBytes.length),
        fileSha256: 'dummy_sha256',
      },
    });

    return book;
  }

  // ── 1. Security & CSRF Enforcements ─────────────────────────────────────────
  test('1. Library indexing endpoints reject unauthenticated requests with 401', async () => {
    const resStatus = await fetch(`${baseUrl}/api/ocr/library/status`);
    assert.strictEqual(resStatus.status, 401);

    const resStart = await fetch(`${baseUrl}/api/ocr/library/start`, { method: 'POST' });
    assert.strictEqual(resStart.status, 401);
  });

  test('2. Library indexing mutation endpoints reject missing/invalid CSRF token with 403', async () => {
    const user = await createAuthenticatedUser('CSRF User', `csrf_${Date.now()}@test.library`, 'SecurePass123!');

    const resNoCsrf = await fetch(`${baseUrl}/api/ocr/library/start`, {
      method: 'POST',
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${user.cookie}` },
    });
    assert.strictEqual(resNoCsrf.status, 403);

    const resBadCsrf = await fetch(`${baseUrl}/api/ocr/library/start`, {
      method: 'POST',
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${user.cookie}`,
        'x-csrf-token': 'invalid_token_value',
      },
    });
    assert.strictEqual(resBadCsrf.status, 403);
  });

  // ── 2. Library Discovery & Audit Report ─────────────────────────────────────
  test('3. GET /api/ocr/library/status accurately reports library overview and status categories', async () => {
    const user = await createAuthenticatedUser('Discovery User', `discovery_${Date.now()}@test.library`, 'SecurePass123!');

    // Book A: Physical PDF exists, unindexed
    const bookA = await createTestBookWithPhysicalPdf(user, 'Book Alpha', 'Native text on alpha page');

    // Book B: Book without physical file
    const bookResB = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Book Beta Without File', totalPages: 1 }),
    });
    const { book: bookB } = await bookResB.json();
    testBookIds.push(bookB.id);

    const res = await fetch(`${baseUrl}/api/ocr/library/status`, {
      headers: user.headers,
    });
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.summary.totalBooks, 2);
    assert.strictEqual(data.summary.eligibleBooks, 1);
    assert.strictEqual(data.summary.missingFileBooks, 1);
    assert.strictEqual(data.summary.unindexedBooks, 1);
    assert.strictEqual(data.summary.fullyIndexedBooks, 0);

    const bookAStatus = data.books.find((b) => b.bookId === bookA.id);
    assert.strictEqual(bookAStatus.physicalPdfExists, true);
    assert.strictEqual(bookAStatus.status, 'UNINDEXED');

    const bookBStatus = data.books.find((b) => b.bookId === bookB.id);
    assert.strictEqual(bookBStatus.physicalPdfExists, false);
    assert.strictEqual(bookBStatus.status, 'FILE_MISSING');
  });

  // ── 3. Enqueue & Sequential Processing ─────────────────────────────────────
  test('4. POST /api/ocr/library/start enqueues eligible books and runs sequentially', async () => {
    const user = await createAuthenticatedUser('Sequential User', `sequential_${Date.now()}@test.library`, 'SecurePass123!');

    // Create 2 test books
    const book1 = await createTestBookWithPhysicalPdf(user, 'Seq Book 1', 'Content for first book with sufficient word length and character count');
    const book2 = await createTestBookWithPhysicalPdf(user, 'Seq Book 2', 'Content for second book with sufficient word length and character count');

    const startRes = await fetch(`${baseUrl}/api/ocr/library/start`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(startRes.status, 202);

    const startData = await startRes.json();
    assert.strictEqual(startData.enqueuedCount, 2);

    // Poll until both books are indexed sequentially
    let isComplete = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`${baseUrl}/api/ocr/library/status`, { headers: user.headers });
      const statusData = await statusRes.json();
      if (statusData.summary.fullyIndexedBooks === 2) {
        isComplete = true;
        break;
      }
    }

    assert.ok(isComplete, 'Expected both books to be fully indexed by sequential queue');

    // Verify search tokens are stored for both
    const pages1 = await prisma.bookPageOcr.findMany({ where: { bookId: book1.id } });
    const pages2 = await prisma.bookPageOcr.findMany({ where: { bookId: book2.id } });
    assert.strictEqual(pages1.length, 1);
    assert.strictEqual(pages2.length, 1);
    assert.strictEqual(pages1[0].source, 'NATIVE');
    assert.strictEqual(pages2[0].source, 'NATIVE');
  });

  // ── 4. Queue Pause & Resume Controls ───────────────────────────────────────
  test('5. POST /api/ocr/library/pause and /resume safely control queue state', async () => {
    const user = await createAuthenticatedUser('Pause User', `pause_${Date.now()}@test.library`, 'SecurePass123!');

    // Pause queue initially
    const pauseRes = await fetch(`${baseUrl}/api/ocr/library/pause`, {
      method: 'POST',
      headers: user.headers,
    });
    assert.strictEqual(pauseRes.status, 200);
    const pauseData = await pauseRes.json();
    assert.strictEqual(pauseData.isPaused, true);

    // Verify status reflects paused state
    const statusRes = await fetch(`${baseUrl}/api/ocr/library/status`, { headers: user.headers });
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.summary.isPaused, true);

    // Resume queue
    const resumeRes = await fetch(`${baseUrl}/api/ocr/library/resume`, {
      method: 'POST',
      headers: user.headers,
    });
    assert.strictEqual(resumeRes.status, 200);
    const resumeData = await resumeRes.json();
    assert.strictEqual(resumeData.isPaused, false);
  });

  // ── 5. Multi-Tenant Isolation ──────────────────────────────────────────────
  test('6. Multi-tenant isolation: User A and User B cannot view or trigger each others books', async () => {
    const userA = await createAuthenticatedUser('User A', `usera_${Date.now()}@test.library`, 'SecurePass123!');
    const userB = await createAuthenticatedUser('User B', `userb_${Date.now()}@test.library`, 'SecurePass123!');

    const bookA = await createTestBookWithPhysicalPdf(userA, 'User A Secret Book', 'Private text for User A');

    // User B status should show 0 books
    const resStatusB = await fetch(`${baseUrl}/api/ocr/library/status`, { headers: userB.headers });
    const dataB = await resStatusB.json();
    assert.strictEqual(dataB.summary.totalBooks, 0);
    assert.strictEqual(dataB.books.length, 0);

    // User B cannot trigger indexing on User A book
    const startResB = await fetch(`${baseUrl}/api/books/${bookA.id}/ocr`, {
      method: 'POST',
      headers: { ...userB.headers, 'Content-Type': 'application/json' },
    });
    assert.strictEqual(startResB.status, 404);
  });
});
