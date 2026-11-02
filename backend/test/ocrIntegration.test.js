import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb } from 'pdf-lib';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths } from '../src/config/storage.js';
import { NativeTextExtractor } from '../src/services/nativeTextExtractor.js';
import { DevanagariSearchNormalizer } from '../src/utils/devanagariNormalizer.js';
import { OcrClient, OcrClientError, ocrClient } from '../src/services/ocrClient.js';
import { OcrJobService } from '../src/services/ocrJobService.js';
import { resolveSafeStoragePath } from '../src/services/storageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Aks — Phase OCR-3A: Secure Backend Integration & Search Reliability Suite', () => {
  let server;
  let baseUrl;
  let mockWorkerServer;
  let mockWorkerUrl;

  const testUserIds = [];
  const testBookIds = [];
  const createdPhysicalFiles = [];

  // Track mock worker behavior
  let mockOcrResponseHandler = null;

  before(async () => {
    // 1. Start main Aks Express server on ephemeral port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // 2. Start mock Python OCR Worker on another ephemeral port
    mockWorkerServer = http.createServer((req, res) => {
      if (mockOcrResponseHandler) {
        return mockOcrResponseHandler(req, res);
      }
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'healthy', active_workers: 0, normalizer_version: '1.0.0' }));
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => mockWorkerServer.listen(0, resolve));
    const workerPort = mockWorkerServer.address().port;
    mockWorkerUrl = `http://127.0.0.1:${workerPort}`;
  });

  after(async () => {
    // Clean up DB records
    if (testBookIds.length > 0) {
      await prisma.bookPageOcr.deleteMany({ where: { bookId: { in: testBookIds } } }).catch(() => {});
      await prisma.ocrJob.deleteMany({ where: { bookId: { in: testBookIds } } }).catch(() => {});
      await prisma.bookFile.deleteMany({ where: { bookId: { in: testBookIds } } }).catch(() => {});
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } }).catch(() => {});
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } }).catch(() => {});
    }

    // Clean up physical test files
    for (const f of createdPhysicalFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }

    // Close servers
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

  async function createTestBookWithPdf(user, pdfBuffer, title = 'Test Volume') {
    const book = await prisma.book.create({
      data: {
        userId: user.userId,
        title,
        totalPages: 1,
      },
    });
    testBookIds.push(book.id);

    // Save physical file
    const userPdfDir = path.join(storagePaths.pdfs, user.userId);
    fs.mkdirSync(userPdfDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(userPdfDir, `${book.id}.pdf`);
    fs.writeFileSync(filePath, pdfBuffer);
    createdPhysicalFiles.push(filePath);

    const relativeStoragePath = path.join('pdfs', user.userId, `${book.id}.pdf`);
    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        storagePath: relativeStoragePath,
        filename: 'document.pdf',
        fileSizeBytes: BigInt(pdfBuffer.length),
      },
    });

    return book;
  }

  // ── 1. Unit Tests: Normalizer & Separation ──────────────────────────────────
  test('1. Devanagari normalizer preserves raw text separation and avoids semantic collisions', () => {
    // Exact transcription preservation
    const rawTranscript = 'राजा का राज़ (राज) गहरा था।';
    const tokens = DevanagariSearchNormalizer.toSearchTokens(rawTranscript, { stripNuktas: false });

    // Raw transcript string must not be modified
    assert.strictEqual(rawTranscript, 'राजा का राज़ (राज) गहरा था।');

    // Tokens must be generated
    assert.ok(tokens.includes('राजा'));
    assert.ok(tokens.includes('राज़'));
    assert.ok(tokens.includes('राज'));

    // राज and राज़ must remain distinct tokens when stripNuktas is false
    const raj = DevanagariSearchNormalizer.toSearchTokens('राज')[0];
    const raaz = DevanagariSearchNormalizer.toSearchTokens('राज़')[0];
    assert.notStrictEqual(raj, raaz, 'राज and राज़ must not collide');

    // Positive spelling variants must match
    const varna1 = DevanagariSearchNormalizer.toSearchTokens('सम्बन्ध')[0];
    const varna2 = DevanagariSearchNormalizer.toSearchTokens('संबंध')[0];
    assert.strictEqual(varna1, varna2, 'सम्बन्ध and संबंध must normalize to identical search token');
  });

  // ── 2. Native-Text Page Bypassing OCR ────────────────────────────────────────
  test('2. Native-text page bypasses OCR worker completely and stores source=NATIVE', async () => {
    const user = await createAuthenticatedUser('Scholar One', 'scholar1@aks.library', 'SecurePass123!');

    // Generate a clean digital PDF with usable native text
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    page.drawText('In Trika Shaivism, the individual soul is regarded as a microcosmic reflection of the divine.', {
      x: 50,
      y: 700,
      size: 14,
    });
    const pdfBytes = await pdfDoc.save();

    const book = await createTestBookWithPdf(user, Buffer.from(pdfBytes), 'Digital Kashmir Shaivism');

    // Configure mock worker to fail if called (verifying it is BYPASSED)
    let workerCalled = false;
    mockOcrResponseHandler = (req, res) => {
      workerCalled = true;
      res.writeHead(500);
      res.end();
    };

    // Request OCR via API
    const res = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
      method: 'POST',
      headers: {
        ...user.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ language: 'en' }),
    });

    assert.strictEqual(res.status, 202);
    const body = await res.json();
    assert.strictEqual(body.isExisting, false);
    assert.strictEqual(body.job.status, 'PENDING');

    // Wait for asynchronous processing
    let jobCompleted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusRes = await fetch(`${baseUrl}/api/books/${book.id}/ocr/status`, {
        headers: user.headers,
      });
      const statusData = await statusRes.json();
      if (statusData.latestJob?.status === 'COMPLETED') {
        jobCompleted = true;
        assert.strictEqual(statusData.nativePages, 1);
        assert.strictEqual(statusData.ocrPages, 0);
        break;
      }
    }
    assert.ok(jobCompleted, 'Job should complete successfully via native extraction');
    assert.strictEqual(workerCalled, false, 'Python OCR worker must NOT be called for native text pages');

    // Verify page OCR record
    const pageRes = await fetch(`${baseUrl}/api/books/${book.id}/ocr/pages/1`, {
      headers: user.headers,
    });
    assert.strictEqual(pageRes.status, 200);
    const { page: pageData } = await pageRes.json();
    assert.strictEqual(pageData.source, 'NATIVE');
    assert.strictEqual(pageData.confidence, 1.0);
    assert.ok(pageData.rawText.includes('Trika Shaivism'));
    assert.ok(pageData.searchTokens.includes('trika'));
    assert.ok(pageData.searchTokens.includes('shaivism'));
  });

  // ── 3. Scanned Page Triggering OCR ──────────────────────────────────────────
  test('3. Scanned page without native text triggers OCR worker and stores source=OCR', async () => {
    const user = await createAuthenticatedUser('Scholar Two', 'scholar2@aks.library', 'SecurePass123!');

    // Generate a scanned-like page (empty text, blank canvas)
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([600, 800]); // Blank page simulating pure scan
    const pdfBytes = await pdfDoc.save();

    const book = await createTestBookWithPdf(user, Buffer.from(pdfBytes), 'Scanned Sanskrit Manuscript');

    // Configure mock OCR worker response
    let ocrReceivedRequest = null;
    mockOcrResponseHandler = async (req, res) => {
      if (req.url === '/ocr/pdf' && req.method === 'POST') {
        let reqBody = '';
        req.on('data', (chunk) => { reqBody += chunk; });
        req.on('end', () => {
          ocrReceivedRequest = JSON.parse(reqBody);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              document_name: 'test.pdf',
              language: 'sa',
              dpi: 250,
              total_pages_in_pdf: 1,
              processed_pages_count: 1,
              peak_rss_mb: 2500,
              pages: [
                {
                  page_number: 1,
                  width: 600,
                  height: 800,
                  dpi: 250,
                  detected_rotation: 0,
                  line_count: 1,
                  average_confidence: 0.96,
                  duration_ms: 120,
                  cold_start: false,
                  lines: [
                    {
                      text: 'ॐ नमः शिवाय',
                      confidence: 0.98,
                      bbox: [[10, 10], [100, 10], [100, 30], [10, 30]],
                    },
                  ],
                  error: null,
                },
              ],
            })
          );
        });
      }
    };

    // Instantiate custom client pointing to mock worker
    const customClient = new OcrClient({ baseUrl: mockWorkerUrl });

    // Execute job with custom worker client
    const customJob = await prisma.ocrJob.create({
      data: {
        userId: user.userId,
        bookId: book.id,
        language: 'sa',
        status: 'PENDING',
        totalPages: 1,
      },
    });

    // Run execution with mocked OCR client
    const originalClient = ocrClient.processPdf;
    ocrClient.processPdf = (params) => customClient.processPdf(params);

    try {
      await OcrJobService.executeJob(customJob.id);

      const status = await OcrJobService.getBookOcrStatus(book.id, user.userId);
      assert.strictEqual(status.latestJob.status, 'COMPLETED');
      assert.strictEqual(status.ocrPages, 1);
      assert.strictEqual(status.nativePages, 0);

      const pageOcr = await OcrJobService.getBookPageOcr(book.id, 1, user.userId);
      assert.strictEqual(pageOcr.source, 'OCR');
      assert.strictEqual(pageOcr.confidence, 0.96);
      assert.strictEqual(pageOcr.rawText, 'ॐ नमः शिवाय');
      assert.ok(pageOcr.searchTokens.includes('नमः'));
      assert.ok(pageOcr.searchTokens.includes('शिवाय'));
    } finally {
      ocrClient.processPdf = originalClient;
    }
  });

  // ── 4. Mixed PDFs (Native + Scanned Pages) ──────────────────────────────────
  test('4. Mixed PDF: Page 1 native text bypasses OCR, Page 2 scanned triggers OCR', async () => {
    const user = await createAuthenticatedUser('Scholar Three', 'scholar3@aks.library', 'SecurePass123!');

    // 2-page PDF: Page 1 has text, Page 2 is blank (scan)
    const pdfDoc = await PDFDocument.create();
    const page1 = pdfDoc.addPage([600, 800]);
    page1.drawText('Page One Introduction to Aesthetics and Theory of Knowledge.', { x: 50, y: 700, size: 14 });
    pdfDoc.addPage([600, 800]); // Page 2 empty
    const pdfBytes = await pdfDoc.save();

    const book = await createTestBookWithPdf(user, Buffer.from(pdfBytes), 'Mixed Two-Page Volume');
    await prisma.book.update({ where: { id: book.id }, data: { totalPages: 2 } });

    mockOcrResponseHandler = (req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            pages: [
              {
                page_number: 1,
                width: 600,
                height: 800,
                lines: [{ text: 'Page Two Scanned Footnote', confidence: 0.91, bbox: [] }],
                average_confidence: 0.91,
                line_count: 1,
              },
            ],
          })
        );
      });
    };

    const customClient = new OcrClient({ baseUrl: mockWorkerUrl });
    const originalClient = ocrClient.processPdf;
    ocrClient.processPdf = (params) => customClient.processPdf(params);

    try {
      const { job } = await OcrJobService.requestJob({
        userId: user.userId,
        bookId: book.id,
        language: 'en',
      });

      // Wait for completion
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const current = await OcrJobService.getJobStatus(job.id, user.userId);
        if (current.status === 'COMPLETED') break;
      }

      const p1 = await OcrJobService.getBookPageOcr(book.id, 1, user.userId);
      const p2 = await OcrJobService.getBookPageOcr(book.id, 2, user.userId);

      assert.strictEqual(p1.source, 'NATIVE', 'Page 1 must be NATIVE');
      assert.strictEqual(p2.source, 'OCR', 'Page 2 must be OCR');
    } finally {
      ocrClient.processPdf = originalClient;
    }
  });

  // ── 5. Authentication and Multi-Tenant Book Ownership ───────────────────────
  test('5. Multi-tenant isolation: Unauthenticated requests and cross-user access rejected', async () => {
    const userA = await createAuthenticatedUser('User A', 'usera@aks.library', 'PassA123!');
    const userB = await createAuthenticatedUser('User B', 'userb@aks.library', 'PassB123!');

    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([600, 800]);
    const pdfBytes = await pdfDoc.save();
    const bookA = await createTestBookWithPdf(userA, Buffer.from(pdfBytes), 'User A Secret Journal');

    // 1. Unauthenticated request rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/books/${bookA.id}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.strictEqual(unauthRes.status, 401);

    // 2. User B requesting OCR on User A book rejected with 404
    const crossReqRes = await fetch(`${baseUrl}/api/books/${bookA.id}/ocr`, {
      method: 'POST',
      headers: {
        ...userB.headers,
        'Content-Type': 'application/json',
      },
    });
    assert.strictEqual(crossReqRes.status, 404);

    // 3. User B retrieving User A book OCR status rejected with 404
    const crossStatusRes = await fetch(`${baseUrl}/api/books/${bookA.id}/ocr/status`, {
      headers: userB.headers,
    });
    assert.strictEqual(crossStatusRes.status, 404);
  });

  // ── 6. Duplicate Job Prevention & Idempotency ────────────────────────────────
  test('6. Duplicate job prevention returns existing job without spawning duplicates', async () => {
    const user = await createAuthenticatedUser('Idempotent User', 'idem@aks.library', 'PassIdem123!');

    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([600, 800]);
    const pdfBytes = await pdfDoc.save();
    const book = await createTestBookWithPdf(user, Buffer.from(pdfBytes), 'Idempotency Test');

    // Send first request with idempotency key
    const res1 = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
      method: 'POST',
      headers: {
        ...user.headers,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-unique-12345',
      },
      body: JSON.stringify({ language: 'en' }),
    });
    assert.strictEqual(res1.status, 202);
    const body1 = await res1.json();
    assert.strictEqual(body1.isExisting, false);

    // Send second request with identical idempotency key
    const res2 = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
      method: 'POST',
      headers: {
        ...user.headers,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-unique-12345',
      },
      body: JSON.stringify({ language: 'en' }),
    });
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.isExisting, true);
    assert.strictEqual(body2.job.id, body1.job.id, 'Idempotent request must return identical job ID');

    // Verify only 1 job exists in DB
    const jobsCount = await prisma.ocrJob.count({
      where: { bookId: book.id, userId: user.userId },
    });
    assert.strictEqual(jobsCount, 1, 'Only one OCR job must be created');
  });

  // ── 7. Worker Unavailable Handling ──────────────────────────────────────────
  test('7. Worker offline handled gracefully without crashing Node.js backend', async () => {
    const client = new OcrClient({ baseUrl: 'http://127.0.0.1:59999' }); // non-listening port

    const health = await client.checkHealth(500);
    assert.strictEqual(health.isHealthy, false);
    assert.ok(health.error.includes('Connection failed') || health.error.includes('timed out'));

    await assert.rejects(
      async () => {
        await client.processPdf({ pdfPath: '/dummy.pdf', timeoutMs: 500 });
      },
      (err) => {
        return err instanceof OcrClientError && err.code === 'OCR_WORKER_UNAVAILABLE';
      }
    );
  });

  // ── 8. Worker HTTP 429 Concurrency Backoff ──────────────────────────────────
  test('8. Worker HTTP 429 returns structured error with Retry-After header', async () => {
    mockOcrResponseHandler = (req, res) => {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '3',
      });
      res.end(JSON.stringify({ detail: 'Concurrency limit exceeded' }));
    };

    const client = new OcrClient({ baseUrl: mockWorkerUrl });
    await assert.rejects(
      async () => {
        await client.processPdf({ pdfPath: '/dummy.pdf' });
      },
      (err) => {
        return (
          err instanceof OcrClientError &&
          err.statusCode === 429 &&
          err.code === 'OCR_WORKER_BUSY' &&
          err.retryAfter === 3
        );
      }
    );
  });

  // ── 9. Timeout Handling via AbortController ─────────────────────────────────
  test('9. Slow worker triggers timeout and aborts cleanly', async () => {
    mockOcrResponseHandler = (req, res) => {
      // Intentionally do not reply to trigger timeout
    };

    const client = new OcrClient({ baseUrl: mockWorkerUrl });
    await assert.rejects(
      async () => {
        await client.processPdf({ pdfPath: '/dummy.pdf', timeoutMs: 80 });
      },
      (err) => {
        return err instanceof OcrClientError && err.code === 'OCR_TIMEOUT' && err.statusCode === 504;
      }
    );
  });

  // ── 10. Backend Restart Recovery ────────────────────────────────────────────
  test('10. Backend restart reconciles interrupted PROCESSING jobs to FAILED', async () => {
    const user = await createAuthenticatedUser('Restart User', 'restart@aks.library', 'PassRestart123!');

    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([600, 800]);
    const pdfBytes = await pdfDoc.save();
    const book = await createTestBookWithPdf(user, Buffer.from(pdfBytes), 'Restart Volume');

    // Artificially inject an interrupted PROCESSING job into DB
    const danglingJob = await prisma.ocrJob.create({
      data: {
        userId: user.userId,
        bookId: book.id,
        status: 'PROCESSING',
        startedAt: new Date(Date.now() - 60000),
      },
    });

    // Run recovery
    await OcrJobService.recoverDanglingJobs();

    // Verify job status updated to FAILED with recovery message
    const recovered = await prisma.ocrJob.findUnique({
      where: { id: danglingJob.id },
    });
    assert.strictEqual(recovered.status, 'FAILED');
    assert.ok(recovered.errorMessage.includes('interrupted by a backend server restart'));
  });

  // ── 11. Temporary File Cleanup ──────────────────────────────────────────────
  test('11. Zero lingering temporary files in storage/temp', () => {
    if (fs.existsSync(storagePaths.temp)) {
      const files = fs.readdirSync(storagePaths.temp);
      const ocrTemps = files.filter((f) => f.includes('ocr_') || f.includes('.tmp'));
      assert.strictEqual(ocrTemps.length, 0, 'No temporary files should linger in storage/temp');
    }
  });
});

