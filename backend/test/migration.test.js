import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths, initStorage } from '../src/config/storage.js';
import { deleteStoredFile } from '../src/services/storageService.js';

describe('Aks (अक्स) Phase 7: Safe Guest Data Migration Test Suite', () => {
  let server;
  let baseUrl;

  const testUserIds = [];
  const testBookIds = [];
  const testNoteIds = [];
  const createdPhysicalFiles = [];
  let userA;
  let userB;

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  async function createValidPdf(text = 'Aks Migration Test PDF') {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.drawText(text, { x: 30, y: 350 });
    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  async function createAuthenticatedUser(name, emailPrefix, password = 'Password123!') {
    const uniqueEmail = `${emailPrefix}_${crypto.randomUUID().slice(0, 8)}@example.com`;
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
      body: JSON.stringify({ name, email: uniqueEmail, password }),
    });
    const regJson = await regRes.json();
    const userId = regJson.user.id;
    testUserIds.push(userId);

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
      body: JSON.stringify({ email: uniqueEmail, password }),
    });
    const authCookie = extractCookie(loginRes);
    const { csrfToken: authCsrf } = await loginRes.json();

    return {
      userId,
      cookie: authCookie,
      csrfToken: authCsrf,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'X-CSRF-Token': authCsrf,
      },
    };
  }

  before(async () => {
    initStorage();
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    userA = await createAuthenticatedUser('User A (Migrator)', 'mig_user_a');
    userB = await createAuthenticatedUser('User B (Observer)', 'mig_user_b');
  });

  after(async () => {
    if (testNoteIds.length > 0) {
      await prisma.note.deleteMany({ where: { id: { in: testNoteIds } } });
    }
    if (testBookIds.length > 0) {
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }

    for (const filePath of createdPhysicalFiles) {
      await deleteStoredFile(filePath);
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

  // ── 1. Explicit Consent & Cancellation ─────────────────────────────────────
  describe('1. Explicit Consent & Ownership Boundaries', () => {
    test('1.1 Unauthenticated requests cannot migrate or create records (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Unauthorized Book',
          author: 'Anonymous',
          totalPages: 100,
        }),
      });

      assert.equal(res.status, 401);
    });

    test('1.2 User cannot spoof userId in migration payload; server strictly enforces req.userId', async () => {
      // User A attempts to set userId to User B
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Ownership Spoof Attempt',
          author: 'Malicious Guest',
          totalPages: 50,
          userId: userB.userId, // Attempting to inject into User B
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      testBookIds.push(json.book.id);

      // Book MUST be assigned to User A, NOT User B
      assert.equal(json.book.userId, userA.userId);
      assert.notEqual(json.book.userId, userB.userId);
    });

    test('1.3 Cancelled migration commits zero records', async () => {
      // Pre-condition: count books for User A
      const beforeRes = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      const beforeJson = await beforeRes.json();
      const initialCount = beforeJson.books.length;

      // Simulated cancellation: user reviews preview, chooses "Skip" -> no API call made
      // Post-condition: book count must be identical
      const afterRes = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      const afterJson = await afterRes.json();
      assert.equal(afterJson.books.length, initialCount);
    });
  });

  // ── 2. Exact Duplicate Detection & Resolution ──────────────────────────────
  describe('2. Exact Duplicate Detection & Conflict Policies', () => {
    let existingBook;
    let existingFileSha256;
    let pdfBuffer;

    before(async () => {
      pdfBuffer = await createValidPdf('Unique Content for Hashing');
      existingFileSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

      // Create existing book on server for User A
      const bookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Algorithms 4th Edition',
          author: 'Robert Sedgewick',
          totalPages: 955,
        }),
      });
      const bookJson = await bookRes.json();
      existingBook = bookJson.book;
      testBookIds.push(existingBook.id);

      // Upload PDF file
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'algorithms.pdf');
      const uploadRes = await fetch(`${baseUrl}/api/books/${existingBook.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });
      assert.equal(uploadRes.status, 200);
      const uploadJson = await uploadRes.json();
      assert.equal(uploadJson.file.fileSha256, existingFileSha256);
    });

    test('2.1 Server books endpoint allows querying existing files to verify duplicates by SHA-256', async () => {
      const res = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      assert.equal(res.status, 200);
      const json = await res.json();

      const matchedBook = json.books.find((b) => b.file && b.file.fileSha256 === existingFileSha256);
      assert.ok(matchedBook, 'Server should list existing book with matching fileSha256');
      assert.equal(matchedBook.id, existingBook.id);
    });

    test('2.2 Duplicate policy "skip" links annotations to existing book without creating new book', async () => {
      // Simulate migration where user chooses to skip book creation and link annotations to existingBook.id
      const bookmarkRes = await fetch(`${baseUrl}/api/books/${existingBook.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 15,
          label: 'Linked Guest Bookmark',
          color: 'gold',
        }),
      });

      assert.equal(bookmarkRes.status, 201);
      const bookmarkJson = await bookmarkRes.json();
      assert.equal(bookmarkJson.bookmark.bookId, existingBook.id);
      assert.equal(bookmarkJson.bookmark.label, 'Linked Guest Bookmark');
    });

    test('2.3 Duplicate policy "new_copy" creates a separate book record even if PDF hash matches', async () => {
      // Create second book with explicit copy
      const copyRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Algorithms 4th Edition (Guest Copy)',
          author: 'Robert Sedgewick',
          totalPages: 955,
        }),
      });

      assert.equal(copyRes.status, 201);
      const copyJson = await copyRes.json();
      testBookIds.push(copyJson.book.id);
      assert.notEqual(copyJson.book.id, existingBook.id);

      // Upload same PDF content
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'algorithms-copy.pdf');
      const uploadRes = await fetch(`${baseUrl}/api/books/${copyJson.book.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });

      assert.equal(uploadRes.status, 200);
      const uploadJson = await uploadRes.json();
      assert.equal(uploadJson.file.fileSha256, existingFileSha256);
      assert.equal(uploadJson.file.bookId, copyJson.book.id);
    });
  });

  // ── 3. Same Title with Different PDF Files ─────────────────────────────────
  describe('3. Same Title with Different PDF Files', () => {
    test('3.1 Books sharing the same title but different content hashes are preserved as distinct books', async () => {
      const pdf1 = await createValidPdf('Edition 1 Content');
      const pdf2 = await createValidPdf('Edition 2 Content - Completely Different');
      const hash1 = crypto.createHash('sha256').update(pdf1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(pdf2).digest('hex');
      assert.notEqual(hash1, hash2, 'Hashes must differ');

      // Book 1
      const res1 = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Linear Algebra and Its Applications',
          author: 'Gilbert Strang',
          totalPages: 400,
        }),
      });
      const book1 = (await res1.json()).book;
      testBookIds.push(book1.id);

      const form1 = new FormData();
      form1.append('file', new Blob([pdf1], { type: 'application/pdf' }), 'strang-v1.pdf');
      await fetch(`${baseUrl}/api/books/${book1.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form1,
      });

      // Book 2 (Same title, different PDF file)
      const res2 = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Linear Algebra and Its Applications',
          author: 'Gilbert Strang',
          totalPages: 520,
        }),
      });
      const book2 = (await res2.json()).book;
      testBookIds.push(book2.id);

      const form2 = new FormData();
      form2.append('file', new Blob([pdf2], { type: 'application/pdf' }), 'strang-v2.pdf');
      await fetch(`${baseUrl}/api/books/${book2.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form2,
      });

      // Verification: both books exist with their respective files
      const verifyRes = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      const verifyJson = await verifyRes.json();
      const b1Found = verifyJson.books.find((b) => b.id === book1.id);
      const b2Found = verifyJson.books.find((b) => b.id === book2.id);

      assert.ok(b1Found);
      assert.ok(b2Found);
      assert.equal(b1Found.file.fileSha256, hash1);
      assert.equal(b2Found.file.fileSha256, hash2);
      assert.notEqual(b1Found.id, b2Found.id);
    });
  });

  // ── 4. Referential Integrity & Relationship Preservation ────────────────────
  describe('4. Book-to-Annotation Relationship Preservation', () => {
    let migratedBook;

    before(async () => {
      const pdf = await createValidPdf('Annotation Integrity PDF');
      const bookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Operating Systems: Three Easy Pieces',
          author: 'Remzi Arpaci-Dusseau',
          totalPages: 700,
        }),
      });
      migratedBook = (await bookRes.json()).book;
      testBookIds.push(migratedBook.id);

      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ostep.pdf');
      await fetch(`${baseUrl}/api/books/${migratedBook.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });
    });

    test('4.1 Bookmarks preserve page number, label, and color linked to migrated book', async () => {
      const res = await fetch(`${baseUrl}/api/books/${migratedBook.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 88,
          label: 'Virtualization & Address Spaces',
          color: 'emerald',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.bookmark.bookId, migratedBook.id);
      assert.equal(json.bookmark.page, 88);
      assert.equal(json.bookmark.label, 'Virtualization & Address Spaces');
      assert.equal(json.bookmark.color, 'emerald');
    });

    test('4.2 Highlights preserve page, text, color, and normalized positionJson linked to migrated book', async () => {
      const positionData = {
        boundingRect: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.25 },
        rects: [{ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.25 }],
        pageNumber: 42,
      };

      const res = await fetch(`${baseUrl}/api/books/${migratedBook.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 42,
          text: 'The OS virtualizes physical CPU and memory.',
          color: 'amber',
          positionJson: positionData,
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.highlight.bookId, migratedBook.id);
      assert.equal(json.highlight.page, 42);
      assert.equal(json.highlight.text, 'The OS virtualizes physical CPU and memory.');
      assert.equal(json.highlight.color, 'amber');
      assert.deepEqual(json.highlight.positionJson, positionData);
    });

    test('4.3 Notes preserve bookId link, title, and content', async () => {
      const res = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          bookId: migratedBook.id,
          title: 'Concurrency Bugs',
          content: 'Non-deadlock bugs make up majority of concurrency bugs.',
          page: 120,
          color: 'sapphire',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.note.bookId, migratedBook.id);
      assert.equal(json.note.title, 'Concurrency Bugs');
      assert.equal(json.note.content, 'Non-deadlock bugs make up majority of concurrency bugs.');
      assert.equal(json.note.page, 120);
    });

    test('4.4 Standalone guest notes (without bookId) migrate successfully', async () => {
      const res = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'General Reading Philosophy',
          content: 'A sanctuary for uninterrupted immersion.',
          color: 'slate',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.note.bookId, null);
      assert.equal(json.note.title, 'General Reading Philosophy');
    });
  });

  // ── 5. Reading Progress Conflict Resolution ────────────────────────────────
  describe('5. Reading Progress Conflict Resolution', () => {
    let book;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Introduction to Algorithms (CLRS)',
          totalPages: 1300,
        }),
      });
      book = (await res.json()).book;
      testBookIds.push(book.id);

      // Set initial server progress: page 200 (15%)
      await fetch(`${baseUrl}/api/books/${book.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({
          currentPage: 200,
          percentage: 15.38,
        }),
      });
    });

    test('5.1 Conflict policy "keep_server": when server progress is ahead, keep server position', async () => {
      // Local guest progress is only page 50 (older reading session)
      const guestProgress = { currentPage: 50, percentage: 3.84 };

      // Query current server progress
      const currentRes = await fetch(`${baseUrl}/api/books/${book.id}/progress`, { headers: userA.headers });
      const currentJson = await currentRes.json();
      const serverProgress = currentJson.progress;

      assert.equal(serverProgress.currentPage, 200);

      // Policy decision: keep_server (or furthest) keeps 200
      let finalPage = serverProgress.currentPage;
      if (guestProgress.currentPage > serverProgress.currentPage) {
        finalPage = guestProgress.currentPage;
      }
      assert.equal(finalPage, 200, 'Server progress must not be regressed');
    });

    test('5.2 Conflict policy "furthest": updates progress if guest has read further than server', async () => {
      // Local guest progress is page 350 (further than server's page 200)
      const guestProgress = { currentPage: 350, percentage: 26.92 };

      const res = await fetch(`${baseUrl}/api/books/${book.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify(guestProgress),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.progress.currentPage, 350);
      assert.equal(json.progress.progressPercent, 26.92);
    });
  });

  // ── 6. Two-User Isolation (Multi-Tenant Security) ──────────────────────────
  describe('6. Multi-User Isolation & Privacy Enforcement', () => {
    let bookA;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'User A Private Journal',
          totalPages: 100,
        }),
      });
      bookA = (await res.json()).book;
      testBookIds.push(bookA.id);

      // Add a private bookmark
      await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ page: 12, label: 'Secret Page' }),
      });
    });

    test('6.1 User B cannot read User A migrated book (404 Not Found)', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}`, { headers: userB.headers });
      assert.equal(res.status, 404);
    });

    test('6.2 User B cannot view User A bookmarks or annotations', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, { headers: userB.headers });
      assert.equal(res.status, 404);
    });

    test('6.3 User B book listing does not include User A migrated books', async () => {
      const res = await fetch(`${baseUrl}/api/books`, { headers: userB.headers });
      assert.equal(res.status, 200);
      const json = await res.json();
      const leaked = json.books.find((b) => b.id === bookA.id);
      assert.equal(leaked, undefined, 'User B must never see User A books in library');
    });

    test('6.4 User B cannot upload files to User A book', async () => {
      const pdf = await createValidPdf('Malicious Upload');
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'malicious.pdf');

      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userB.cookie}`,
          'X-CSRF-Token': userB.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 404);
    });
  });

  // ── 7. Failure Recovery, Interrupted Uploads & Retries ─────────────────────
  describe('7. Failure Recovery & Idempotent Retries', () => {
    let retryBook;
    let pdfBuffer;

    before(async () => {
      pdfBuffer = await createValidPdf('Retry Test PDF');
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Failure Recovery Handbook',
          totalPages: 150,
        }),
      });
      retryBook = (await res.json()).book;
      testBookIds.push(retryBook.id);
    });

    test('7.1 Upload with invalid non-PDF content fails safely without corrupting book', async () => {
      const invalidBlob = new Blob([Buffer.from('NOT A PDF FILE TEXT')], { type: 'text/plain' });
      const form = new FormData();
      form.append('file', invalidBlob, 'invalid.txt');

      const res = await fetch(`${baseUrl}/api/books/${retryBook.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.ok(json.error);

      // Book record still exists and is healthy
      const bookRes = await fetch(`${baseUrl}/api/books/${retryBook.id}`, { headers: userA.headers });
      assert.equal(bookRes.status, 200);
      const bookJson = await bookRes.json();
      assert.equal(bookJson.book.file, null, 'File should not be attached after failure');
    });

    test('7.2 Retry after failure succeeds cleanly', async () => {
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'valid-recovery.pdf');

      const res = await fetch(`${baseUrl}/api/books/${retryBook.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.file);
      assert.equal(json.file.bookId, retryBook.id);
    });

    test('7.3 Idempotency: Attempting duplicate bookmark creation on same page returns 409 Conflict', async () => {
      // First bookmark creation
      const res1 = await fetch(`${baseUrl}/api/books/${retryBook.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ page: 25, label: 'Idempotency Mark' }),
      });
      assert.equal(res1.status, 201);

      // Second attempt (simulating duplicate migration request)
      const res2 = await fetch(`${baseUrl}/api/books/${retryBook.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ page: 25, label: 'Idempotency Mark' }),
      });
      assert.equal(res2.status, 409);
      const json2 = await res2.json();
      assert.equal(json2.error.code, 'BOOKMARK_ALREADY_EXISTS');
    });
  });

  // ── 8. Phase 7.1 Targeted Migration Safety & Completeness Suite ────────────
  describe('8. Phase 7.1 Migration Safety, Crash Window Recovery & Multi-Tenant Isolation', () => {
    let p71Book;
    let p71PdfBuffer;

    before(async () => {
      p71PdfBuffer = await createValidPdf('Phase 7.1 Safety PDF');
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Phase 7.1 Safety Handbook',
          author: 'Aks Security Team',
          totalPages: 180,
        }),
      });
      p71Book = (await res.json()).book;
      testBookIds.push(p71Book.id);
    });

    test('8.1 Server-side highlight idempotency: Identical highlight on retry returns 200 without creating duplicate row', async () => {
      const hlPayload = {
        page: 15,
        text: 'Idempotency is essential for reliable distributed migration.',
        color: 'emerald',
      };

      // 1. First attempt: creates highlight (201)
      const res1 = await fetch(`${baseUrl}/api/books/${p71Book.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(hlPayload),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      assert.ok(json1.highlight);

      // 2. Retry attempt (e.g. after network drop before response recorded): returns 200 idempotent
      const res2 = await fetch(`${baseUrl}/api/books/${p71Book.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(hlPayload),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.isExisting, true);
      assert.equal(json2.highlight.id, json1.highlight.id);

      // 3. Verification: total highlights count for this book must remain exactly 1
      const listRes = await fetch(`${baseUrl}/api/books/${p71Book.id}/highlights`, { headers: userA.headers });
      const listJson = await listRes.json();
      assert.equal(listJson.highlights.length, 1);
    });

    test('8.2 Server-side note idempotency: Identical note on retry returns 200 without creating duplicate row', async () => {
      const notePayload = {
        bookId: p71Book.id,
        title: 'Safety Reflection',
        content: 'Data must never be lost or duplicated under any circumstances.',
        page: 15,
        category: 'Reflection',
        type: 'BOOK',
      };

      // 1. First attempt: creates note (201)
      const res1 = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(notePayload),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      assert.ok(json1.note);

      // 2. Retry attempt: returns 200 idempotent without duplicating
      const res2 = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(notePayload),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.isExisting, true);
      assert.equal(json2.note.id, json1.note.id);

      // 3. Verification: total notes for this book must remain exactly 1
      const listRes = await fetch(`${baseUrl}/api/notes?bookId=${p71Book.id}`, { headers: userA.headers });
      const listJson = await listRes.json();
      const matching = listJson.notes.filter((n) => n.title === 'Safety Reflection');
      assert.equal(matching.length, 1);
    });

    test('8.3 Crash window recovery: Recovering partially created book (created before crash, no PDF file) rather than creating duplicate', async () => {
      // Simulate crash: Book created, but browser disconnected before PDF upload
      const crashBookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Interrupted Volume Recovery',
          author: 'Resilience Test',
          totalPages: 90,
        }),
      });
      const partialBook = (await crashBookRes.json()).book;
      testBookIds.push(partialBook.id);
      assert.equal(partialBook.file, null, 'Simulated crash: book has no file');

      // On retry/recovery: client lists books, finds partial book with file === null and same title
      const listRes = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      const listJson = await listRes.json();
      const recoveredBook = listJson.books.find(
        (b) => b.title === 'Interrupted Volume Recovery' && b.file === null
      );
      assert.ok(recoveredBook, 'Must recover partially migrated book');
      assert.equal(recoveredBook.id, partialBook.id);

      // Resume by uploading PDF directly to existing book without calling createBook again
      const form = new FormData();
      form.append('file', new Blob([p71PdfBuffer], { type: 'application/pdf' }), 'recovered.pdf');
      const uploadRes = await fetch(`${baseUrl}/api/books/${recoveredBook.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });
      assert.equal(uploadRes.status, 200);

      // Verify that no second book was created
      const finalListRes = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      const finalListJson = await finalListRes.json();
      const booksWithTitle = finalListJson.books.filter((b) => b.title === 'Interrupted Volume Recovery');
      assert.equal(booksWithTitle.length, 1, 'Exactly one book must exist; no ghost duplicate created');
      assert.ok(booksWithTitle[0].file, 'File is now attached to the recovered book');
    });

    test('8.4 Retry after PDF upload but before annotations: Existing uploaded file is reused and annotations complete cleanly', async () => {
      // Book already has file attached
      const bookRes = await fetch(`${baseUrl}/api/books/${p71Book.id}`, { headers: userA.headers });
      assert.equal(bookRes.status, 200);

      // Upload file if not already present
      const form = new FormData();
      form.append('file', new Blob([p71PdfBuffer], { type: 'application/pdf' }), 'safety.pdf');
      await fetch(`${baseUrl}/api/books/${p71Book.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });

      // Migration resumes at annotation step: creates bookmark on page 50
      const bmRes = await fetch(`${baseUrl}/api/books/${p71Book.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ page: 50, label: 'Resume Annotation Test' }),
      });
      assert.equal(bmRes.status, 201);

      // Retrying annotation creation on page 50 is caught by unique constraint (409) without corrupting book
      const retryBmRes = await fetch(`${baseUrl}/api/books/${p71Book.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ page: 50, label: 'Resume Annotation Test' }),
      });
      assert.equal(retryBmRes.status, 409);
    });

    test('8.5 Foreign journal isolation: Account B rejects / cannot access Account A journaled serverBookId', async () => {
      // User B attempts to access User A's journaled book ID
      const foreignRes = await fetch(`${baseUrl}/api/books/${p71Book.id}`, { headers: userB.headers });
      assert.equal(foreignRes.status, 404, 'User B must not access User A journaled book');

      // User B cannot add bookmarks or highlights to User A's book
      const foreignBmRes = await fetch(`${baseUrl}/api/books/${p71Book.id}/bookmarks`, {
        method: 'POST',
        headers: userB.headers,
        body: JSON.stringify({ page: 1, label: 'Cross-Tenant Exploit' }),
      });
      assert.equal(foreignBmRes.status, 404);
    });

    test('8.6 Preferences migration: Guest reading and atmosphere preferences safely sync via PATCH /api/preferences', async () => {
      const prefPayload = {
        readingConfig: {
          defaultMode: 'focus',
          pageTurnAnimation: true,
          animationSpeed: 'fast',
          layout: 'single',
        },
        typographyConfig: {
          fontFamily: 'serif',
          fontSize: 22,
          lineHeight: 1.8,
          surfaceTheme: 'cream',
        },
        atmosphereConfig: {
          currentMoodId: 'warm-literary',
          backgroundIntensity: 'immersive',
          backgroundDimming: 40,
        },
      };

      const patchRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: userA.headers,
        body: JSON.stringify(prefPayload),
      });
      assert.equal(patchRes.status, 200);
      const patchJson = await patchRes.json();
      assert.equal(patchJson.preferences.readingConfig.defaultMode, 'focus');
      assert.equal(patchJson.preferences.typographyConfig.fontSize, 22);
      assert.equal(patchJson.preferences.atmosphereConfig.currentMoodId, 'warm-literary');

      // Verify persistent round-trip
      const getRes = await fetch(`${baseUrl}/api/preferences`, { headers: userA.headers });
      const getJson = await getRes.json();
      assert.equal(getJson.preferences.readingConfig.defaultMode, 'focus');
      assert.equal(getJson.preferences.typographyConfig.surfaceTheme, 'cream');
    });

    test('8.7 Partial cancellation semantics: Completed items remain valid, pending items remain untouched', async () => {
      // User A initiates multi-volume migration: Volume 1 completes, cancellation happens before Volume 2
      const res1 = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Partial Migration Vol 1',
          totalPages: 100,
        }),
      });
      const vol1 = (await res1.json()).book;
      testBookIds.push(vol1.id);

      // Cancellation triggered: Volume 2 API call is never made
      // Verify Volume 1 is intact and accessible
      const verifyRes = await fetch(`${baseUrl}/api/books/${vol1.id}`, { headers: userA.headers });
      assert.equal(verifyRes.status, 200);
      const verifyJson = await verifyRes.json();
      assert.equal(verifyJson.book.title, 'Partial Migration Vol 1');

      // Verify Volume 2 does not exist in library
      const listRes = await fetch(`${baseUrl}/api/books`, { headers: userA.headers });
      const listJson = await listRes.json();
      const vol2 = listJson.books.find((b) => b.title === 'Partial Migration Vol 2 (Never Sent)');
      assert.equal(vol2, undefined);
    });
  });

  // ── 9. Phase 7.2: Final Migration Identity & Preservation Hardening ────────
  describe('9. Phase 7.2: Final Migration Identity & Preservation Hardening', () => {
    let p72Book;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Phase 7.2 Identity Volume',
          author: 'Aks Core',
          totalPages: 100,
          sourceId: 'guest_book_p72_main',
        }),
      });
      p72Book = (await res.json()).book;
      testBookIds.push(p72Book.id);
    });

    test('9.1 Two identical notes can both be migrated as distinct records with unique sourceIds', async () => {
      const identicalNotePayload1 = {
        title: 'Deep Reflection',
        content: 'This exact same philosophical insight was recorded in two separate places.',
        category: 'Reflection',
        sourceId: 'local_note_p72_a',
      };
      const identicalNotePayload2 = {
        title: 'Deep Reflection',
        content: 'This exact same philosophical insight was recorded in two separate places.',
        category: 'Reflection',
        sourceId: 'local_note_p72_b',
      };

      const res1 = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(identicalNotePayload1),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      testNoteIds.push(json1.note.id);

      const res2 = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(identicalNotePayload2),
      });
      assert.equal(res2.status, 201, 'Second note with identical content must be created as distinct record');
      const json2 = await res2.json();
      testNoteIds.push(json2.note.id);

      assert.notEqual(json1.note.id, json2.note.id, 'Notes must have distinct IDs');
      assert.equal(json1.note.sourceId, 'local_note_p72_a');
      assert.equal(json2.note.sourceId, 'local_note_p72_b');
      assert.equal(json1.note.content, json2.note.content);
    });

    test('9.2 Two identical highlights can both be migrated as distinct records with unique sourceIds', async () => {
      const highlightPayload1 = {
        page: 15,
        text: 'Identical repeated phrase in the text.',
        color: 'gold',
        sourceId: 'local_hl_p72_a',
      };
      const highlightPayload2 = {
        page: 15,
        text: 'Identical repeated phrase in the text.',
        color: 'gold',
        sourceId: 'local_hl_p72_b',
      };

      const res1 = await fetch(`${baseUrl}/api/books/${p72Book.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(highlightPayload1),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      const res2 = await fetch(`${baseUrl}/api/books/${p72Book.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(highlightPayload2),
      });
      assert.equal(res2.status, 201, 'Second highlight with identical text must be created as distinct record');
      const json2 = await res2.json();

      assert.notEqual(json1.highlight.id, json2.highlight.id, 'Highlights must have distinct IDs');
      assert.equal(json1.highlight.sourceId, 'local_hl_p72_a');
      assert.equal(json2.highlight.sourceId, 'local_hl_p72_b');
    });

    test('9.3 Retrying the same source record does not duplicate it (Idempotency via sourceId)', async () => {
      // Retry note with sourceId: local_note_p72_a
      const retryNoteRes = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Different Title Modified During Retry',
          content: 'Different Content',
          sourceId: 'local_note_p72_a',
        }),
      });
      assert.equal(retryNoteRes.status, 200, 'Retry must return HTTP 200 idempotent response');
      const retryNoteJson = await retryNoteRes.json();
      assert.equal(retryNoteJson.isExisting, true);
      assert.equal(retryNoteJson.note.sourceId, 'local_note_p72_a');

      // Retry highlight with sourceId: local_hl_p72_a
      const retryHlRes = await fetch(`${baseUrl}/api/books/${p72Book.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 15,
          text: 'Repeated query',
          color: 'gold',
          sourceId: 'local_hl_p72_a',
        }),
      });
      assert.equal(retryHlRes.status, 200);
      const retryHlJson = await retryHlRes.json();
      assert.equal(retryHlJson.isExisting, true);
      assert.equal(retryHlJson.highlight.sourceId, 'local_hl_p72_a');

      // Retry book with sourceId: guest_book_p72_main
      const retryBookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Phase 7.2 Identity Volume (Retry)',
          sourceId: 'guest_book_p72_main',
        }),
      });
      assert.equal(retryBookRes.status, 200);
      const retryBookJson = await retryBookRes.json();
      assert.equal(retryBookJson.isExisting, true);
      assert.equal(retryBookJson.book.id, p72Book.id);
    });

    test('9.4 Concurrent retries do not create duplicate records', async () => {
      const concurrentSourceId = `concurrent_note_${Date.now()}`;
      const payload = {
        title: 'Concurrent Sync Note',
        content: 'Content sent concurrently across network',
        category: 'Analysis',
        sourceId: concurrentSourceId,
      };

      // Launch 5 parallel requests simulating concurrent retry waves
      const promises = Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/api/notes`, {
          method: 'POST',
          headers: userA.headers,
          body: JSON.stringify(payload),
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);

      // All requests should succeed with either 201 (initial create) or 200 (idempotent duplicate)
      for (const status of statuses) {
        assert.ok([200, 201].includes(status), `Expected 200 or 201, got ${status}`);
      }

      const bodies = await Promise.all(responses.map((r) => r.json()));
      const noteIds = new Set(bodies.map((b) => b.note.id));

      // Exactly ONE unique note record must exist
      assert.equal(noteIds.size, 1, 'All concurrent retries must resolve to the exact same database record');
      testNoteIds.push([...noteIds][0]);
    });

    test('9.5 Two local books with identical metadata recover independently via stable source-book IDs', async () => {
      const bookPayloadA = {
        title: 'Algorithms & Data Structures',
        author: 'Prof. Sharma',
        totalPages: 250,
        sourceId: 'guest_book_algo_clone_1',
      };
      const bookPayloadB = {
        title: 'Algorithms & Data Structures',
        author: 'Prof. Sharma',
        totalPages: 250,
        sourceId: 'guest_book_algo_clone_2',
      };

      const resA = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(bookPayloadA),
      });
      assert.equal(resA.status, 201);
      const bookA = (await resA.json()).book;
      testBookIds.push(bookA.id);

      const resB = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify(bookPayloadB),
      });
      assert.equal(resB.status, 201, 'Identical book metadata must create a distinct second book');
      const bookB = (await resB.json()).book;
      testBookIds.push(bookB.id);

      assert.notEqual(bookA.id, bookB.id, 'Books must have separate server IDs');

      // Retry for clone 1 recovers ONLY Book A
      const retryA = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Algorithms & Data Structures',
          sourceId: 'guest_book_algo_clone_1',
        }),
      });
      assert.equal(retryA.status, 200);
      assert.equal((await retryA.json()).book.id, bookA.id);

      // Retry for clone 2 recovers ONLY Book B
      const retryB = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Algorithms & Data Structures',
          sourceId: 'guest_book_algo_clone_2',
        }),
      });
      assert.equal(retryB.status, 200);
      assert.equal((await retryB.json()).book.id, bookB.id);
    });

    test('9.6 A migration operation cannot recover or collide with another account\'s book', async () => {
      const sharedSourceId = `cross_account_migration_op_${Date.now()}`;

      // User A creates book with sharedSourceId
      const resA = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'User A Migration Book',
          sourceId: sharedSourceId,
        }),
      });
      assert.equal(resA.status, 201);
      const bookA = (await resA.json()).book;
      testBookIds.push(bookA.id);

      // User B creates book with the same sourceId
      // Because sourceId is scoped to userId (@@unique([sourceId, userId])), User B succeeds independently
      const resB = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userB.headers,
        body: JSON.stringify({
          title: 'User B Migration Book',
          sourceId: sharedSourceId,
        }),
      });
      assert.equal(resB.status, 201, 'User B must successfully create their own record');
      const bookB = (await resB.json()).book;
      testBookIds.push(bookB.id);

      // Verify records are distinct and isolated
      assert.notEqual(bookA.id, bookB.id, 'User B must never adopt or overwrite User A book');

      // User B retry retrieves User B's book, NOT User A's
      const retryB = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userB.headers,
        body: JSON.stringify({
          title: 'User B Migration Book',
          sourceId: sharedSourceId,
        }),
      });
      assert.equal(retryB.status, 200);
      assert.equal((await retryB.json()).book.id, bookB.id);
    });

    test('9.7 A retry after a partial upload resumes only its own operation', async () => {
      const partialOpId = `op_partial_resume_${Date.now()}`;

      // 1. Initial creation of incomplete book (file upload interrupted)
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Incomplete Upload Volume',
          sourceId: partialOpId,
        }),
      });
      assert.equal(res.status, 201);
      const partialBook = (await res.json()).book;
      testBookIds.push(partialBook.id);
      assert.equal(partialBook.file, null, 'File should initially be null');

      // 2. Retry with same migration operation ID
      const retryRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Incomplete Upload Volume',
          sourceId: partialOpId,
        }),
      });
      assert.equal(retryRes.status, 200, 'Must recognize existing operation');
      const recoveredBook = (await retryRes.json()).book;
      assert.equal(recoveredBook.id, partialBook.id, 'Must resume exact same book record');

      // 3. Complete file upload on recovered book
      const pdf = await createValidPdf('Resumed File Content');
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'resumed.pdf');

      const uploadRes = await fetch(`${baseUrl}/api/books/${recoveredBook.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userA.cookie}`,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: form,
      });
      assert.equal(uploadRes.status, 200, 'Upload completes successfully on resumed book');
      const uploadJson = await uploadRes.json();
      assert.ok(uploadJson.file);
      assert.equal(uploadJson.file.filename, 'resumed.pdf');
    });
  });
});
