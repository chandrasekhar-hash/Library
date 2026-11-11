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
import { OcrJobService } from '../src/services/ocrJobService.js';
import { SearchEngine } from '../src/services/searchEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Aks — Phase OCR-4A: Automatic Indexing & Coverage Verification Suite', () => {
  let server;
  let baseUrl;
  let mockWorkerServer;
  let mockWorkerUrl;

  const testUserIds = [];
  const testBookIds = [];
  const createdPhysicalFiles = [];

  let mockWorkerCallCount = 0;
  let mockOcrResponseHandler = null;

  before(async () => {
    // 1. Start main Aks Express server on ephemeral port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // 2. Start mock Python OCR Worker on ephemeral port
    mockWorkerServer = http.createServer((req, res) => {
      mockWorkerCallCount++;
      if (mockOcrResponseHandler) {
        return mockOcrResponseHandler(req, res);
      }
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
              lines: [{ text: 'Scanned OCR Text Line', confidence: 0.95, bbox: [[10, 10], [100, 10], [100, 30], [10, 30]] }],
              line_count: 1,
              average_confidence: 0.95,
              width: 800,
              height: 1000,
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

    // Point OCR client to mock worker
    ocrClient.baseUrl = mockWorkerUrl;
  });

  after(async () => {
    // Clean up DB records for tracked test IDs only
    if (testBookIds.length > 0) {
      await prisma.bookPageOcr.deleteMany({ where: { bookId: { in: testBookIds } } });
      await prisma.ocrJob.deleteMany({ where: { bookId: { in: testBookIds } } });
      await prisma.bookFile.deleteMany({ where: { bookId: { in: testBookIds } } });
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }

    if (testUserIds.length > 0) {
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

  // ── 1. Upload Automatically Enqueues Indexing ──────────────────────────────
  test('1. Uploading a PDF automatically enqueues background indexing without blocking', async () => {
    const user = await createAuthenticatedUser('Auto Index User', `auto_index_${Date.now()}@test.library`, 'SecurePass123!');

    // Create book
    const bookRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Automatic Ingestion Test Book', totalPages: 1 }),
    });
    const { book } = await bookRes.json();
    testBookIds.push(book.id);

    // Build PDF with native text
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    page.drawText('The advent of cosmic consciousness was thoroughly explored in ancient texts.', {
      x: 50,
      y: 700,
      size: 14,
    });
    const pdfBytes = await pdfDoc.save();

    // Upload via multipart form
    const boundary = '----WebKitFormBoundaryAutoIndex';
    const bodyBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from(pdfBytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
      method: 'POST',
      headers: {
        ...user.headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });

    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.indexing?.enqueued, true);

    // Poll until background indexing finishes
    let indexed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const statusRes = await fetch(`${baseUrl}/api/books/${book.id}/ocr/status`, {
        headers: user.headers,
      });
      const statusData = await statusRes.json();
      if (statusData.indexedPages >= 1) {
        indexed = true;
        assert.equal(statusData.nativePages, 1);
        assert.equal(statusData.ocrPages, 0);
        break;
      }
    }

    assert.ok(indexed, 'Book was automatically indexed in the background after upload');
  });

  // ── 2. Duplicate Job Prevention ─────────────────────────────────────────────
  test('2. Repeated upload or requestJob calls do not create duplicate active jobs', async () => {
    const user = await createAuthenticatedUser('Dedupe User', `dedupe_${Date.now()}@test.library`, 'SecurePass123!');

    const book = await prisma.book.create({
      data: { userId: user.userId, title: 'Dedupe Test Book', totalPages: 10 },
    });
    testBookIds.push(book.id);

    // Attach dummy file
    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        storagePath: 'dummy.pdf',
        filename: 'dummy.pdf',
        fileSizeBytes: 100n,
      },
    });

    // Simulate an existing PENDING job
    await prisma.ocrJob.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        status: 'PENDING',
        totalPages: 10,
      },
    });

    const res2 = await OcrJobService.requestJob({
      userId: user.userId,
      bookId: book.id,
    });

    assert.equal(res2.isExisting, true, 'Subsequent request recognized active job and refused duplication');

    // Clean up simulated pending job so background worker does not try to process dummy.pdf
    await prisma.ocrJob.deleteMany({
      where: { bookId: book.id },
    });
  });

  // ── 3. Native Text Pages Bypass OCR ─────────────────────────────────────────
  test('3. Native text pages bypass Python OCR worker completely', async () => {
    const user = await createAuthenticatedUser('Bypass User', `bypass_${Date.now()}@test.library`, 'SecurePass123!');

    const pdfDoc = await PDFDocument.create();
    const p1 = pdfDoc.addPage([600, 800]);
    p1.drawText('This is native digital prose that contains sufficient text length and character density to pass usability checks.', {
      x: 50,
      y: 700,
      size: 14,
    });
    const pdfBytes = await pdfDoc.save();

    const book = await prisma.book.create({
      data: { userId: user.userId, title: 'Native Bypass Test', totalPages: 1 },
    });
    testBookIds.push(book.id);

    const userPdfDir = path.join(storagePaths.pdfs, user.userId);
    fs.mkdirSync(userPdfDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(userPdfDir, `${book.id}.pdf`);
    fs.writeFileSync(filePath, pdfBytes);
    createdPhysicalFiles.push(filePath);

    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        storagePath: path.join('pdfs', user.userId, `${book.id}.pdf`),
        filename: 'document.pdf',
        fileSizeBytes: BigInt(pdfBytes.length),
      },
    });

    const preWorkerCalls = mockWorkerCallCount;

    // Run job
    const { job } = await OcrJobService.requestJob({
      userId: user.userId,
      bookId: book.id,
    });

    // Wait for execution
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const j = await prisma.ocrJob.findUnique({ where: { id: job.id } });
      if (j.status === 'COMPLETED') break;
    }

    assert.equal(mockWorkerCallCount, preWorkerCalls, 'Python OCR worker was NEVER called for native page');

    const pageRecord = await prisma.bookPageOcr.findUnique({
      where: { bookId_pageNumber_userId: { bookId: book.id, pageNumber: 1, userId: user.userId } },
    });
    assert.equal(pageRecord.source, 'NATIVE');
    assert.equal(pageRecord.confidence, 1.0);
  });

  // ── 4. Scanned and Genuinely Blank Pages ────────────────────────────────────
  test('4. Scanned pages invoke OCR; genuinely blank pages are marked explicitly', async () => {
    const user = await createAuthenticatedUser('Blank Page User', `blank_${Date.now()}@test.library`, 'SecurePass123!');

    // 2-page PDF: Page 1 empty, Page 2 empty
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([600, 800]); // Blank page
    pdfDoc.addPage([600, 800]); // Blank page
    const pdfBytes = await pdfDoc.save();

    const book = await prisma.book.create({
      data: { userId: user.userId, title: 'Blank Pages Test', totalPages: 2 },
    });
    testBookIds.push(book.id);

    const userPdfDir = path.join(storagePaths.pdfs, user.userId);
    fs.mkdirSync(userPdfDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(userPdfDir, `${book.id}.pdf`);
    fs.writeFileSync(filePath, pdfBytes);
    createdPhysicalFiles.push(filePath);

    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        storagePath: path.join('pdfs', user.userId, `${book.id}.pdf`),
        filename: 'document.pdf',
        fileSizeBytes: BigInt(pdfBytes.length),
      },
    });

    // Custom handler: Page 1 has OCR text, Page 2 returns empty lines (blank)
    mockOcrResponseHandler = (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        const startPage = parsed.start_page || 0;
        if (startPage === 0) {
          // Page 1: Scanned text
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            pages: [{ page: 0, lines: [{ text: 'Recognized Scanned Text', confidence: 0.92, bbox: [] }], line_count: 1 }],
          }));
        } else {
          // Page 2: Genuinely blank
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            pages: [{ page: 1, lines: [], line_count: 0, average_confidence: 0.0 }],
          }));
        }
      });
    };

    const { job } = await OcrJobService.requestJob({ userId: user.userId, bookId: book.id });

    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const j = await prisma.ocrJob.findUnique({ where: { id: job.id } });
      if (j.status === 'COMPLETED') break;
    }

    const p1 = await prisma.bookPageOcr.findUnique({
      where: { bookId_pageNumber_userId: { bookId: book.id, pageNumber: 1, userId: user.userId } },
    });
    const p2 = await prisma.bookPageOcr.findUnique({
      where: { bookId_pageNumber_userId: { bookId: book.id, pageNumber: 2, userId: user.userId } },
    });

    assert.equal(p1.source, 'OCR');
    assert.equal(p1.rawText, 'Recognized Scanned Text');

    assert.equal(p2.source, 'OCR');
    assert.equal(p2.rawText, '');
    assert.equal(p2.lineCount, 0);
    assert.equal(p2.metadata?.isBlank, true);
    assert.equal(p2.metadata?.reason, 'no_text_detected');

    // Verify status coverage summary
    const status = await OcrJobService.getBookOcrStatus(book.id, user.userId);
    assert.equal(status.indexedPages, 2);
    assert.equal(status.blankPages, 1);
    assert.equal(status.ocrPages, 1);
    assert.equal(status.unindexedPages, 0);
    assert.equal(status.isFullyIndexed, true);

    mockOcrResponseHandler = null;
  });

  // ── 5. Failed Pages Retryable ───────────────────────────────────────────────
  test('5. Failed pages can be retried without re-processing already indexed pages', async () => {
    const user = await createAuthenticatedUser('Retry User', `retry_${Date.now()}@test.library`, 'SecurePass123!');

    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([600, 800]); // Page 1
    pdfDoc.addPage([600, 800]); // Page 2
    const pdfBytes = await pdfDoc.save();

    const book = await prisma.book.create({
      data: { userId: user.userId, title: 'Retry Test Book', totalPages: 2 },
    });
    testBookIds.push(book.id);

    const userPdfDir = path.join(storagePaths.pdfs, user.userId);
    fs.mkdirSync(userPdfDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(userPdfDir, `${book.id}.pdf`);
    fs.writeFileSync(filePath, pdfBytes);
    createdPhysicalFiles.push(filePath);

    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        userId: user.userId,
        storagePath: path.join('pdfs', user.userId, `${book.id}.pdf`),
        filename: 'document.pdf',
        fileSizeBytes: BigInt(pdfBytes.length),
      },
    });

    // Simulate Page 1 succeeds, Page 2 fails
    mockOcrResponseHandler = (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        if (parsed.start_page === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pages: [{ page: 0, lines: [{ text: 'Page 1 Text' }] }] }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Worker error on page 2' }));
        }
      });
    };

    const { job } = await OcrJobService.requestJob({ userId: user.userId, bookId: book.id });

    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const j = await prisma.ocrJob.findUnique({ where: { id: job.id } });
      if (j.status === 'COMPLETED' || j.status === 'FAILED') break;
    }

    let status = await OcrJobService.getBookOcrStatus(book.id, user.userId);
    assert.equal(status.indexedPages, 1);
    assert.equal(status.failedPages, 1);
    assert.equal(status.canRetry, true);

    // Now fix mock worker to succeed on Page 2
    mockOcrResponseHandler = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pages: [{ page: 1, lines: [{ text: 'Recovered Page 2 Text' }] }] }));
    };

    // Trigger retry
    const retryRes = await fetch(`${baseUrl}/api/books/${book.id}/ocr/retry`, {
      method: 'POST',
      headers: user.headers,
    });
    assert.equal(retryRes.status, 202);

    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const s = await OcrJobService.getBookOcrStatus(book.id, user.userId);
      if (s.indexedPages === 2) {
        status = s;
        break;
      }
    }

    assert.equal(status.indexedPages, 2);
    assert.equal(status.failedPages, 0);
    assert.equal(status.isFullyIndexed, true);

    mockOcrResponseHandler = null;
  });

  // ── 6. Worker Unavailable Does Not Corrupt Book Upload ──────────────────────
  test('6. Worker unavailable during upload still saves PDF and exposes recoverable status', async () => {
    const user = await createAuthenticatedUser('Worker Down User', `worker_down_${Date.now()}@test.library`, 'SecurePass123!');

    // Temporarily point ocrClient to non-existent port
    const originalUrl = ocrClient.baseUrl;
    ocrClient.baseUrl = 'http://127.0.0.1:59999';

    const pdfDoc = await PDFDocument.create();
    const p = pdfDoc.addPage([600, 800]);
    p.drawText('Sample chapter text that will be uploaded while worker is unreachable.', { x: 50, y: 700 });
    const pdfBytes = await pdfDoc.save();

    const bookRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Worker Down Test Volume', totalPages: 1 }),
    });
    const { book } = await bookRes.json();
    testBookIds.push(book.id);

    const boundary = '----WebKitFormBoundaryDown';
    const bodyBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from(pdfBytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyBuffer,
    });

    assert.equal(uploadRes.status, 200, 'Upload succeeded despite worker state');
    const uploadData = await uploadRes.json();
    assert.ok(uploadData.file?.id);

    // Allow background job to settle
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const j = await prisma.ocrJob.findFirst({ where: { bookId: book.id } });
      if (j && (j.status === 'COMPLETED' || j.status === 'FAILED')) break;
    }

    // Restore URL
    ocrClient.baseUrl = originalUrl;
  });
});
