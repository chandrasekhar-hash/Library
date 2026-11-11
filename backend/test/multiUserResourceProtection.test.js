process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths } from '../src/config/storage.js';
import { QuotaService } from '../src/services/quotaService.js';
import { OcrJobService } from '../src/services/ocrJobService.js';
import { deleteStoredFile } from '../src/services/storageService.js';
import { assertTestDatabase, assertTestResource } from '../src/utils/testDatabaseGuard.js';

describe('Aks — Multi-User Resource Protection & Storage Quota Test Suite (DEPLOY-1B.2)', () => {
  let server;
  let baseUrl;

  // Track created test IDs for safe database cleanup
  const testUserIds = [];
  const testBookIds = [];
  const testAssetIds = [];
  const createdPhysicalFiles = [];

  // Minimal valid PDF binary
  const validPdfBuffer = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'),
    Buffer.from('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n'),
    Buffer.from('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n'),
    Buffer.from('xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n'),
    Buffer.from('trailer << /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF'),
  ]);

  // Helper to extract cookie from response
  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Helper to register and log in a test user
  async function createAuthenticatedUser(name, email, password) {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const anonCookie = extractCookie(csrfRes);
    const { csrfToken: regCsrf } = await csrfRes.json();

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
        'X-CSRF-Token': regCsrf,
      },
      body: JSON.stringify({ name, email, password }),
    });
    const regJson = await regRes.json();
    const userId = regJson.user.id;
    testUserIds.push(userId);

    // Login
    const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const loginCsrfCookie = extractCookie(loginCsrfRes);
    const { csrfToken: loginCsrf } = await loginCsrfRes.json();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${loginCsrfCookie}`,
        'X-CSRF-Token': loginCsrf,
      },
      body: JSON.stringify({ email, password }),
    });
    const authCookie = extractCookie(loginRes);

    // Session-bound CSRF token
    const authCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    const { csrfToken: authCsrf } = await authCsrfRes.json();

    return {
      userId,
      cookie: authCookie,
      csrfToken: authCsrf,
      authHeaders: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'X-CSRF-Token': authCsrf,
      },
    };
  }

  // Helper to create a test book for a user
  async function createTestBook(user, title = 'Test Quota Book', totalPages = 10) {
    const res = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...user.authHeaders,
      },
      body: JSON.stringify({ title, totalPages }),
    });
    const json = await res.json();
    testBookIds.push(json.book.id);
    return json.book;
  }

  // Helper to build a multipart form body with binary buffer
  function buildMultipartPdf(buffer, filename = 'test.pdf') {
    const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);
    return {
      body,
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // Clean up test database records safely
    if (testAssetIds.length > 0) {
      assertTestResource(testAssetIds[0], testAssetIds, 'UserAsset');
      await prisma.userAsset.deleteMany({ where: { id: { in: testAssetIds } } });
    }
    if (testBookIds.length > 0) {
      assertTestResource(testBookIds[0], testBookIds, 'Book');
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }
    if (testUserIds.length > 0) {
      assertTestResource(testUserIds[0], testUserIds, 'User');
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }

    // Clean up physical test files
    for (const f of createdPhysicalFiles) {
      await deleteStoredFile(f);
    }
    for (const uId of testUserIds) {
      const uDir = path.join(storagePaths.pdfs, uId);
      if (fs.existsSync(uDir)) {
        try {
          fs.rmSync(uDir, { recursive: true, force: true });
        } catch {}
      }
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // ── 1. Quota Accounting & Storage Endpoint ─────────────────────────────────
  describe('1. Per-User Storage Quota Accounting', () => {
    test('Empty user account starts with 0 bytes used and full 250 MB quota remaining', async () => {
      const user = await createAuthenticatedUser('Empty User', `quota-empty-${Date.now()}@example.com`, 'SecurePass123!');
      const usage = await QuotaService.getUserStorageUsage(user.userId);

      assert.equal(usage.totalBytes, 0);
      assert.equal(usage.pdfBytes, 0);
      assert.equal(usage.assetBytes, 0);
      assert.equal(usage.coverBytes, 0);
      assert.equal(usage.quotaBytes, 250 * 1024 * 1024);
      assert.equal(usage.remainingBytes, 250 * 1024 * 1024);
      assert.equal(usage.usagePercent, 0);

      // Verify GET /api/auth/storage endpoint
      const res = await fetch(`${baseUrl}/api/auth/storage`, {
        headers: user.authHeaders,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.storage);
      assert.equal(data.storage.totalBytes, 0);
      assert.equal(data.storage.quotaBytes, 250 * 1024 * 1024);
    });

    test('QuotaService accurately aggregates PDFs, user assets, and book covers', async () => {
      const user = await createAuthenticatedUser('Agg User', `quota-agg-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'Accounting Test Book');

      // 1. Manually create a BookFile record
      await prisma.bookFile.create({
        data: {
          bookId: book.id,
          userId: user.userId,
          storagePath: `pdfs/${user.userId}/${book.id}.pdf`,
          filename: 'test.pdf',
          fileSizeBytes: BigInt(10 * 1024 * 1024), // 10 MB
        },
      });

      // 2. Create a UserAsset record
      const asset = await prisma.userAsset.create({
        data: {
          userId: user.userId,
          assetType: 'BACKGROUND_IMAGE',
          storagePath: `backgrounds/${user.userId}/bg.jpg`,
          filename: 'bg.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: BigInt(5 * 1024 * 1024), // 5 MB
        },
      });
      testAssetIds.push(asset.id);

      // 3. Update book colorScheme with cover sizes
      await prisma.book.update({
        where: { id_userId: { id: book.id, userId: user.userId } },
        data: {
          colorScheme: {
            defaultCoverSizeBytes: 50 * 1024, // 50 KB
            customCoverSizeBytes: 150 * 1024, // 150 KB
          },
        },
      });

      const usage = await QuotaService.getUserStorageUsage(user.userId);
      assert.equal(usage.pdfBytes, 10 * 1024 * 1024);
      assert.equal(usage.assetBytes, 5 * 1024 * 1024);
      assert.equal(usage.coverBytes, 200 * 1024);
      assert.equal(usage.totalBytes, 10 * 1024 * 1024 + 5 * 1024 * 1024 + 200 * 1024);
      assert.ok(usage.remainingBytes < 250 * 1024 * 1024);
    });

    test('assertQuotaAvailable allows upload within quota and rejects upload exceeding quota', async () => {
      const user = await createAuthenticatedUser('Limit User', `quota-limit-${Date.now()}@example.com`, 'SecurePass123!');

      // Within quota
      await assert.doesNotReject(async () => {
        await QuotaService.assertQuotaAvailable(user.userId, 100 * 1024 * 1024); // 100 MB
      });

      // Exceeding 250 MB quota
      await assert.rejects(
        async () => {
          await QuotaService.assertQuotaAvailable(user.userId, 300 * 1024 * 1024); // 300 MB
        },
        (err) => {
          assert.equal(err.statusCode, 413);
          assert.equal(err.code, 'STORAGE_QUOTA_EXCEEDED');
          assert.ok(err.message.includes('Account storage quota'));
          return true;
        }
      );
    });
  });

  // ── 2. Concurrent Uploads Near Quota (Race Condition Prevention) ───────────
  describe('2. Race Condition Prevention for Concurrent Uploads', () => {
    test('Two simultaneous uploads near the quota: one succeeds, one safely fails with 413 without quota breach', async () => {
      const user = await createAuthenticatedUser('Race User', `quota-race-${Date.now()}@example.com`, 'SecurePass123!');
      const book1 = await createTestBook(user, 'Race Book 1');
      const book2 = await createTestBook(user, 'Race Book 2');
      const bookPlaceholder = await createTestBook(user, 'Placeholder Book');

      // Fill account to 249 MB using a pre-existing book file
      await prisma.bookFile.create({
        data: {
          bookId: bookPlaceholder.id,
          userId: user.userId,
          storagePath: `pdfs/${user.userId}/placeholder.pdf`,
          filename: 'placeholder.pdf',
          fileSizeBytes: BigInt(249 * 1024 * 1024), // 249 MB used, 1 MB remaining
        },
      });

      // Valid PDF of ~800 KB (within 1 MB remaining space)
      const padding = Buffer.alloc(800 * 1024, 32); // 800 KB whitespace
      const paddedPdfBuffer = Buffer.concat([validPdfBuffer, padding]);

      const mp1 = buildMultipartPdf(paddedPdfBuffer, 'race1.pdf');
      const mp2 = buildMultipartPdf(paddedPdfBuffer, 'race2.pdf');

      // Fire both upload requests simultaneously
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/books/${book1.id}/file`, {
          method: 'POST',
          headers: {
            'Content-Type': mp1.contentType,
            ...user.authHeaders,
          },
          body: mp1.body,
        }),
        fetch(`${baseUrl}/api/books/${book2.id}/file`, {
          method: 'POST',
          headers: {
            'Content-Type': mp2.contentType,
            ...user.authHeaders,
          },
          body: mp2.body,
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must succeed (200) and one must be rejected (413 Payload Too Large)
      assert.equal(statuses[0], 200, 'First concurrent upload within quota must succeed');
      assert.equal(statuses[1], 413, 'Second concurrent upload exceeding quota must be rejected with HTTP 413');

      // Verify the 413 response payload
      const rejectedRes = res1.status === 413 ? res1 : res2;
      const rejectedJson = await rejectedRes.json();
      assert.equal(rejectedJson.error.code, 'STORAGE_QUOTA_EXCEEDED');

      // Total stored bytes in database must strictly NOT exceed 250 MB
      const usage = await QuotaService.getUserStorageUsage(user.userId);
      assert.ok(
        usage.totalBytes <= 250 * 1024 * 1024,
        `Total stored bytes (${usage.totalBytes}) must not exceed 250 MB quota (${250 * 1024 * 1024})`
      );
    });
  });

  // ── 3. Deletion and Quota Release ──────────────────────────────────────────
  describe('3. Deletion and Quota Release', () => {
    test('Deleting a book immediately releases its storage from user quota', async () => {
      const user = await createAuthenticatedUser('Delete User', `quota-del-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'Volume to Delete');

      const mp = buildMultipartPdf(validPdfBuffer, 'deletable.pdf');
      const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp.contentType,
          ...user.authHeaders,
        },
        body: mp.body,
      });
      assert.equal(uploadRes.status, 200);

      const usageBeforeDelete = await QuotaService.getUserStorageUsage(user.userId);
      assert.ok(usageBeforeDelete.totalBytes > 0);

      // Delete the book
      const delRes = await fetch(`${baseUrl}/api/books/${book.id}`, {
        method: 'DELETE',
        headers: user.authHeaders,
      });
      assert.equal(delRes.status, 200);

      const usageAfterDelete = await QuotaService.getUserStorageUsage(user.userId);
      assert.equal(usageAfterDelete.totalBytes, 0, 'Storage quota must be immediately 0 after book deletion');
    });

    test('Replacing an existing PDF file deducts old size and updates quota accurately', async () => {
      const user = await createAuthenticatedUser('Replace User', `quota-repl-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'Replacement Book');

      // Upload initial PDF (small)
      const mp1 = buildMultipartPdf(validPdfBuffer, 'small.pdf');
      const res1 = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp1.contentType,
          ...user.authHeaders,
        },
        body: mp1.body,
      });
      assert.equal(res1.status, 200);
      const usage1 = await QuotaService.getUserStorageUsage(user.userId);

      // Upload replacement PDF (larger with padding)
      const paddedBuffer = Buffer.concat([validPdfBuffer, Buffer.alloc(50 * 1024, 32)]);
      const mp2 = buildMultipartPdf(paddedBuffer, 'larger.pdf');
      const res2 = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp2.contentType,
          ...user.authHeaders,
        },
        body: mp2.body,
      });
      assert.equal(res2.status, 200);

      const usage2 = await QuotaService.getUserStorageUsage(user.userId);
      assert.equal(usage2.totalBytes, paddedBuffer.length, 'Total stored bytes must equal replacement file size');
      assert.ok(usage2.totalBytes > usage1.totalBytes);
    });
  });

  // ── 4. Rate Limiting Tests ─────────────────────────────────────────────────
  describe('4. Rate Limiting (Upload, Search, OCR)', () => {
    test('Search endpoint emits rate limit headers and protects against abuse', async () => {
      const user = await createAuthenticatedUser('Search User', `search-rate-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'Search Rate Book');

      const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=test`, {
        headers: user.authHeaders,
      });
      assert.equal(res.status, 200);

      // Check standard RateLimit headers
      assert.ok(
        res.headers.has('ratelimit-limit') || res.headers.has('ratelimit-remaining'),
        'Search endpoint must include RateLimit headers'
      );
    });

    test('OCR dispatch endpoint emits rate limit headers and protects against abuse', async () => {
      const user = await createAuthenticatedUser('Ocr Rate User', `ocr-rate-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'OCR Rate Book');

      // Attach file first
      const mp = buildMultipartPdf(validPdfBuffer, 'ocr_rate.pdf');
      await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp.contentType,
          ...user.authHeaders,
        },
        body: mp.body,
      });

      const res = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...user.authHeaders,
        },
        body: JSON.stringify({ language: 'en' }),
      });
      assert.ok([200, 202].includes(res.status));

      assert.ok(
        res.headers.has('ratelimit-limit') || res.headers.has('ratelimit-remaining'),
        'OCR dispatch endpoint must include RateLimit headers'
      );
    });
  });

  // ── 5. OCR Safeguards & Queue Protection ───────────────────────────────────
  describe('5. OCR Safeguards & Queue Limits', () => {
    test('OCR request rejects book with totalPages exceeding MAX_OCR_PAGE_COUNT (2,000 pages)', async () => {
      const user = await createAuthenticatedUser('Ocr Page User', `ocr-page-${Date.now()}@example.com`, 'SecurePass123!');
      const hugeBook = await createTestBook(user, 'Huge Encyclopedia', 2500); // 2,500 pages

      const mp = buildMultipartPdf(validPdfBuffer, 'huge.pdf');
      await fetch(`${baseUrl}/api/books/${hugeBook.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp.contentType,
          ...user.authHeaders,
        },
        body: mp.body,
      });

      const res = await fetch(`${baseUrl}/api/books/${hugeBook.id}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...user.authHeaders,
        },
        body: JSON.stringify({ language: 'en' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.code, 'PAGE_LIMIT_EXCEEDED');
      assert.ok(data.error.message.includes('2,000 pages'));
    });

    test('Duplicate OCR job request returns existing job without spawning a new one', async () => {
      const user = await createAuthenticatedUser('Dup Ocr User', `dup-ocr-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'Dup OCR Book', 5);

      const mp = buildMultipartPdf(validPdfBuffer, 'dup.pdf');
      await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp.contentType,
          ...user.authHeaders,
        },
        body: mp.body,
      });

      // First request
      const res1 = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...user.authHeaders,
        },
        body: JSON.stringify({ language: 'en' }),
      });
      assert.ok([200, 202].includes(res1.status));

      // Second request immediately after
      const res2 = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...user.authHeaders,
        },
        body: JSON.stringify({ language: 'en' }),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.isExisting, true);
    });

    test('User reaching MAX_QUEUED_OCR_JOBS_PER_USER is rejected with 429 OCR_QUEUE_LIMIT_EXCEEDED', async () => {
      const user = await createAuthenticatedUser('Queue Limit User', `ocr-queue-${Date.now()}@example.com`, 'SecurePass123!');
      const book = await createTestBook(user, 'Target Book', 5);

      // Create dummy PENDING jobs to fill user's queue limit (10 jobs)
      const dummyJobs = [];
      for (let i = 0; i < env.MAX_QUEUED_OCR_JOBS_PER_USER; i++) {
        const dummyBook = await createTestBook(user, `Dummy Book ${i}`, 1);
        const j = await prisma.ocrJob.create({
          data: {
            userId: user.userId,
            bookId: dummyBook.id,
            status: 'PENDING',
          },
        });
        dummyJobs.push(j.id);
      }

      // Attach file to target book
      const mp = buildMultipartPdf(validPdfBuffer, 'target.pdf');
      await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp.contentType,
          ...user.authHeaders,
        },
        body: mp.body,
      });

      // Request OCR when queue limit is reached
      const res = await fetch(`${baseUrl}/api/books/${book.id}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...user.authHeaders,
        },
        body: JSON.stringify({ language: 'en' }),
      });

      assert.equal(res.status, 429);
      const json = await res.json();
      assert.equal(json.error.code, 'OCR_QUEUE_LIMIT_EXCEEDED');

      // Cleanup dummy jobs
      await prisma.ocrJob.deleteMany({ where: { id: { in: dummyJobs } } });
    });
  });

  // ── 6. Multi-User Isolation & Unauthorized Access ──────────────────────────
  describe('6. Multi-User Isolation & Unauthorized Access', () => {
    test('User A cannot view User B storage usage and unauthenticated requests are rejected', async () => {
      const userA = await createAuthenticatedUser('User A', `user-a-${Date.now()}@example.com`, 'PassUserA123!');
      const userB = await createAuthenticatedUser('User B', `user-b-${Date.now()}@example.com`, 'PassUserB123!');

      // Unauthenticated request to /api/auth/storage returns 401
      const unauthRes = await fetch(`${baseUrl}/api/auth/storage`);
      assert.equal(unauthRes.status, 401);

      // User A gets their own storage
      const resA = await fetch(`${baseUrl}/api/auth/storage`, { headers: userA.authHeaders });
      assert.equal(resA.status, 200);
      const dataA = await resA.json();
      assert.equal(dataA.storage.totalBytes, 0);

      // Upload file for User A
      const bookA = await createTestBook(userA, 'Book User A');
      const mp = buildMultipartPdf(validPdfBuffer, 'usera.pdf');
      await fetch(`${baseUrl}/api/books/${bookA.id}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': mp.contentType,
          ...userA.authHeaders,
        },
        body: mp.body,
      });

      // User A usage is updated, User B usage remains 0
      const updatedA = await QuotaService.getUserStorageUsage(userA.userId);
      const usageB = await QuotaService.getUserStorageUsage(userB.userId);

      assert.ok(updatedA.totalBytes > 0);
      assert.equal(usageB.totalBytes, 0, "User A's upload must not increase User B's storage usage");

      // User B cannot query or access User A's book file
      const streamRes = await fetch(`${baseUrl}/api/books/${bookA.id}/file`, {
        headers: userB.authHeaders,
      });
      assert.equal(streamRes.status, 404, 'User B must receive 404 when attempting to stream User A book file');
    });
  });
});
