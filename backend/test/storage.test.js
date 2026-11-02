import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths } from '../src/config/storage.js';
import { streamToTempFile, deleteStoredFile } from '../src/services/storageService.js';

describe('Aks (अक्स) Phase 3: Private Storage & PDF Upload/Streaming Test Suite', () => {
  let server;
  let baseUrl;

  // Track created test IDs for safe cleanup
  const testUserIds = [];
  const testBookIds = [];
  const createdPhysicalFiles = [];

  // Minimal valid PDF binary representation
  const validPdfBuffer = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'),
    Buffer.from('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n'),
    Buffer.from('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n'),
    Buffer.from('xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n'),
    Buffer.from('trailer << /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF'),
  ]);

  // Helper to extract cookie
  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Helper to register and log in a test user, returning auth headers and user ID
  async function createAuthenticatedUser(name, email, password) {
    // 1. Get initial CSRF
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const anonCookie = extractCookie(csrfRes);
    const { csrfToken: regCsrf } = await csrfRes.json();

    // 2. Register
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

    // 3. Login with fresh token
    const postRegCookie = extractCookie(regRes) || anonCookie;
    const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${postRegCookie}` },
    });
    const loginCookie = extractCookie(loginCsrfRes) || postRegCookie;
    const { csrfToken: loginCsrf } = await loginCsrfRes.json();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${loginCookie}`,
        'X-CSRF-Token': loginCsrf,
      },
      body: JSON.stringify({ email, password }),
    });
    const authCookie = extractCookie(loginRes);
    const { csrfToken: authCsrf } = await loginRes.json();

    return {
      userId,
      cookie: authCookie,
      csrfToken: authCsrf,
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'X-CSRF-Token': authCsrf,
      },
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
    // Clean up database records
    if (testBookIds.length > 0) {
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }

    // Clean up test physical files
    for (const filePath of createdPhysicalFiles) {
      await deleteStoredFile(filePath);
    }

    // Clean up user folders in pdfs storage
    for (const uId of testUserIds) {
      const uDir = path.join(storagePaths.pdfs, uId);
      if (fs.existsSync(uDir)) {
        try {
          fs.rmSync(uDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // ── 1. Basic Upload & Security Tests ──────────────────────────────────────
  describe('PDF Upload Endpoint: POST /api/books/:bookId/file', () => {
    test('1. Authenticated user uploads a valid PDF successfully', async () => {
      const user = await createAuthenticatedUser('Upload User', 'upload.user@example.com', 'UploadPassword1!');

      // Create a book for this user
      const book = await prisma.book.create({
        data: {
          userId: user.userId,
          title: 'The Alchemist',
          author: 'Paulo Coelho',
        },
      });
      testBookIds.push(book.id);

      // Create multipart form with valid PDF
      const form = new FormData();
      form.append('file', new Blob([validPdfBuffer], { type: 'application/pdf' }), 'The-Alchemist.pdf');

      const res = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: user.headers,
        body: form,
      });

      assert.equal(res.status, 200);
      const json = await res.json();

      assert.ok(json.file);
      assert.equal(json.file.bookId, book.id);
      assert.equal(json.file.filename, 'The-Alchemist.pdf');
      assert.equal(json.file.mimeType, 'application/pdf');
      assert.equal(json.file.fileSizeBytes, validPdfBuffer.length);
      assert.ok(json.file.fileSha256);
      assert.equal(json.file.storagePath, undefined, 'Internal storagePath must not be leaked in response');

      // Verify in DB
      const dbFile = await prisma.bookFile.findUnique({
        where: { bookId: book.id },
      });
      assert.ok(dbFile);
      assert.equal(dbFile.userId, user.userId);
      createdPhysicalFiles.push(dbFile.storagePath);

      // Verify physical file exists on disk inside storage/pdfs/{userId}/
      const physicalPath = path.resolve(storagePaths.root, dbFile.storagePath);
      assert.ok(fs.existsSync(physicalPath), 'Physical file must exist in storage');
    });

    test('2. Unauthenticated upload is rejected (401)', async () => {
      const form = new FormData();
      form.append('file', new Blob([validPdfBuffer], { type: 'application/pdf' }), 'test.pdf');

      const res = await fetch(`${baseUrl}/api/books/dummy-id/file`, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'some-token',
        },
        body: form,
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.code, 'UNAUTHENTICATED');
    });

    test('3. Upload without a valid CSRF token is rejected (403)', async () => {
      const user = await createAuthenticatedUser('CSRF Test User', 'csrf.upload@example.com', 'CsrfPassword1!');
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'CSRF Book' },
      });
      testBookIds.push(book.id);

      const form = new FormData();
      form.append('file', new Blob([validPdfBuffer], { type: 'application/pdf' }), 'csrf.pdf');

      const res = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.cookie}`,
          'X-CSRF-Token': 'bad-token-00000000000000000000000000000000000000000000000000000000',
        },
        body: form,
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'EBADCSRFTOKEN');
    });

    test('4. User A cannot upload to User B book (404/Isolation)', async () => {
      const userA = await createAuthenticatedUser('User A', 'user.a@example.com', 'PasswordA1!');
      const userB = await createAuthenticatedUser('User B', 'user.b@example.com', 'PasswordB2!');

      // Create book owned by User B
      const bookB = await prisma.book.create({
        data: { userId: userB.userId, title: 'Book of User B' },
      });
      testBookIds.push(bookB.id);

      // User A attempts to upload to User B's book
      const form = new FormData();
      form.append('file', new Blob([validPdfBuffer], { type: 'application/pdf' }), 'attack.pdf');

      const res = await fetch(`${baseUrl}/api/books/${bookB.id}/file`, {
        method: 'POST',
        headers: userA.headers, // User A credentials!
        body: form,
      });

      assert.equal(res.status, 404, 'Attempt to access another user book must yield 404');
      const data = await res.json();
      assert.equal(data.error.code, 'BOOK_NOT_FOUND');
    });
  });

  // ── 2. Validation & Magic Byte Security Tests ─────────────────────────────
  describe('File Validation & Integrity', () => {
    test('6. Invalid PDF signature is rejected even if extension is .pdf (400)', async () => {
      const user = await createAuthenticatedUser('Spoof User', 'spoof@example.com', 'SpoofPassword1!');
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Spoofed Book' },
      });
      testBookIds.push(book.id);

      // Fake file: text file disguised as a PDF
      const fakePdfBuffer = Buffer.from('Plain text file masquerading as a PDF document');

      const form = new FormData();
      form.append('file', new Blob([fakePdfBuffer], { type: 'application/pdf' }), 'malicious.pdf');

      const res = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: user.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.code, 'INVALID_FILE_SIGNATURE');
    });

    test('7. Non-PDF files (e.g. image, html) are rejected (400)', async () => {
      const user = await createAuthenticatedUser('Image User', 'image.upload@example.com', 'ImagePassword1!');
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Image Book' },
      });
      testBookIds.push(book.id);

      const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body>Dangerous Script</body></html>');
      const form = new FormData();
      form.append('file', new Blob([htmlBuffer], { type: 'text/html' }), 'exploit.html');

      const res = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: user.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.code, 'INVALID_FILE_SIGNATURE');
    });

    test('8. File size limit enforcement rejects oversized streaming data safely (413)', async () => {
      // Test streamToTempFile with custom 1KB limit to verify streaming termination & immediate unlink
      const customMaxBytes = 1024; // 1 KB limit
      const oversizedChunk = Buffer.alloc(2048, 0x41); // 2 KB of data
      oversizedChunk.write('%PDF-1.4\n', 0); // Valid header

      const mockStream = Readable.from([oversizedChunk]);

      await assert.rejects(
        async () => {
          await streamToTempFile(mockStream, { maxSizeBytes: customMaxBytes });
        },
        (err) => {
          assert.equal(err.statusCode, 413);
          assert.equal(err.code, 'FILE_TOO_LARGE');
          return true;
        }
      );

      // Verify no temporary files remain in storage/temp
      await new Promise((r) => setTimeout(r, 50));
      const tempFiles = fs.readdirSync(storagePaths.temp);
      const orphanUploads = tempFiles.filter((f) => f.startsWith('upload_'));
      assert.equal(orphanUploads.length, 0, 'Oversized upload must not leave orphaned temp files');
    });

    test('13. Interrupted or failed upload cleans up temporary files', async () => {
      const invalidStream = Readable.from([Buffer.from('not-a-pdf-stream')]);

      await assert.rejects(async () => {
        await streamToTempFile(invalidStream);
      });

      const tempFiles = fs.readdirSync(storagePaths.temp);
      const orphanUploads = tempFiles.filter((f) => f.startsWith('upload_'));
      assert.equal(orphanUploads.length, 0, 'Failed upload must clean up temporary files immediately');
    });
  });

  // ── 3. Streaming & HTTP Range Tests ───────────────────────────────────────
  describe('PDF Streaming Endpoint: GET /api/books/:bookId/file', () => {
    let streamUser;
    let streamBook;

    before(async () => {
      streamUser = await createAuthenticatedUser('Stream User', 'stream.user@example.com', 'StreamPassword1!');
      streamBook = await prisma.book.create({
        data: {
          userId: streamUser.userId,
          title: 'Streaming Novel',
        },
      });
      testBookIds.push(streamBook.id);

      // Upload valid PDF
      const form = new FormData();
      form.append('file', new Blob([validPdfBuffer], { type: 'application/pdf' }), 'novel.pdf');

      const uploadRes = await fetch(`${baseUrl}/api/books/${streamBook.id}/file`, {
        method: 'POST',
        headers: streamUser.headers,
        body: form,
      });
      assert.equal(uploadRes.status, 200);
    });

    test('9. Valid full-file request returns HTTP 200 with complete headers', async () => {
      const res = await fetch(`${baseUrl}/api/books/${streamBook.id}/file`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${streamUser.cookie}`,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.equal(res.headers.get('accept-ranges'), 'bytes');
      assert.equal(parseInt(res.headers.get('content-length'), 10), validPdfBuffer.length);
      assert.ok(res.headers.get('content-disposition')?.includes('inline'));

      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(body.length, validPdfBuffer.length);
      assert.ok(body.equals(validPdfBuffer), 'Downloaded content must match uploaded PDF exactly');
    });

    test('10. Valid byte-range request returns HTTP 206 with correct headers and slice', async () => {
      const start = 0;
      const end = 7; // First 8 bytes: "%PDF-1.4"
      const expectedLength = end - start + 1; // 8 bytes

      const res = await fetch(`${baseUrl}/api/books/${streamBook.id}/file`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${streamUser.cookie}`,
          Range: `bytes=${start}-${end}`,
        },
      });

      assert.equal(res.status, 206, 'Valid range request must return 206 Partial Content');
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.equal(res.headers.get('accept-ranges'), 'bytes');
      assert.equal(parseInt(res.headers.get('content-length'), 10), expectedLength);
      assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${validPdfBuffer.length}`);

      const chunk = Buffer.from(await res.arrayBuffer());
      assert.equal(chunk.length, expectedLength);
      assert.ok(chunk.equals(validPdfBuffer.subarray(start, end + 1)));
    });

    test('11. Invalid byte range returns HTTP 416 Range Not Satisfiable', async () => {
      // Out of bounds range: start beyond EOF
      const res = await fetch(`${baseUrl}/api/books/${streamBook.id}/file`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${streamUser.cookie}`,
          Range: `bytes=999999-9999999`,
        },
      });

      assert.equal(res.status, 416);
      assert.equal(res.headers.get('content-range'), `bytes */${validPdfBuffer.length}`);
    });

    test('12. Missing file returns a safe 404 error without path leakage', async () => {
      // Create book without file
      const emptyBook = await prisma.book.create({
        data: { userId: streamUser.userId, title: 'No File Book' },
      });
      testBookIds.push(emptyBook.id);

      const res = await fetch(`${baseUrl}/api/books/${emptyBook.id}/file`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${streamUser.cookie}`,
        },
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error.code, 'FILE_NOT_FOUND');
    });

    test('5 & 15. User A cannot stream User B PDF (Multi-user isolation)', async () => {
      const attacker = await createAuthenticatedUser('Attacker', 'attacker@example.com', 'AttackerPass1!');

      // Attacker attempts to stream streamBook (owned by streamUser)
      const res = await fetch(`${baseUrl}/api/books/${streamBook.id}/file`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${attacker.cookie}`,
        },
      });

      assert.equal(res.status, 404, 'Cross-user file access must be blocked with 404');
      const data = await res.json();
      assert.equal(data.error.code, 'BOOK_NOT_FOUND');
    });

    test('14. Direct HTTP access to storage directory is blocked (No public static route)', async () => {
      // Attempt to access storage folder directly via web root
      const res1 = await fetch(`${baseUrl}/storage/pdfs/`);
      assert.equal(res1.status, 404);

      const res2 = await fetch(`${baseUrl}/storage/temp/`);
      assert.equal(res2.status, 404);

      const res3 = await fetch(`${baseUrl}/pdfs/`);
      assert.equal(res3.status, 404);
    });
  });
});
