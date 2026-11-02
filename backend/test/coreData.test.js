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
import { withBookLock } from '../src/utils/bookLock.js';

describe('Aks (अक्स) Phase 4: Core Data APIs Test Suite', () => {
  let server;
  let baseUrl;

  const testUserIds = [];
  const testBookIds = [];
  const createdPhysicalFiles = [];
  let suiteUserA;
  let suiteUserB;

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  async function createValidPdf(text = 'Aks Test Document') {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText(text, { x: 20, y: 100 });
    return Buffer.from(await doc.save());
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

    suiteUserA = await createAuthenticatedUser('User A', 'core_user_a');
    suiteUserB = await createAuthenticatedUser('User B', 'core_user_b');
  });

  after(async () => {
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

  // ── 1. Books API ───────────────────────────────────────────────────────────
  describe('1. Books API (/api/books)', () => {
    let userA;
    let userB;
    let bookA;

    before(() => {
      userA = suiteUserA;
      userB = suiteUserB;
    });

    test('1. User A can create a book with valid metadata', async () => {
      const res = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Design Patterns',
          author: 'Erich Gamma et al.',
          category: 'Software Engineering',
          format: 'PDF',
          totalPages: 395,
          colorScheme: { primary: '#4A5568' },
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.book);
      assert.equal(json.book.title, 'Design Patterns');
      assert.equal(json.book.author, 'Erich Gamma et al.');
      assert.equal(json.book.totalPages, 395);
      assert.equal(json.book.userId, userA.userId);
      assert.equal(json.book.status, 'UNREAD');

      bookA = json.book;
      testBookIds.push(bookA.id);
    });

    test('2. User A can retrieve their own book by ID', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}`, {
        headers: userA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.book.id, bookA.id);
      assert.equal(json.book.title, 'Design Patterns');
    });

    test('3. User B cannot retrieve User A book (404 / Multi-User Isolation)', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}`, {
        headers: userB.headers,
      });

      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error.code, 'BOOK_NOT_FOUND');
    });

    test('4. User A can update metadata on their own book', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}`, {
        method: 'PATCH',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Design Patterns: Elements of Reusable Object-Oriented Software',
          category: 'Computer Science',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.book.title, 'Design Patterns: Elements of Reusable Object-Oriented Software');
      assert.equal(json.book.category, 'Computer Science');
    });

    test('5. User B cannot update User A book (404)', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}`, {
        method: 'PATCH',
        headers: userB.headers,
        body: JSON.stringify({ title: 'Hacked Title' }),
      });

      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error.code, 'BOOK_NOT_FOUND');
    });

    test('6. User A lists books with pagination and cannot exceed max limit', async () => {
      // Request with limit 200 (max allowed is 100)
      const res = await fetch(`${baseUrl}/api/books?limit=200&page=1`, {
        headers: userA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.books));
      assert.equal(json.pagination.limit, 100, 'Limit should be clamped to maximum 100');
      assert.ok(json.books.some((b) => b.id === bookA.id));
    });

    test('7. Validation rejects empty title or invalid totalPages', async () => {
      const res1 = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ title: '   ' }),
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ title: 'Valid Title', totalPages: -5 }),
      });
      assert.equal(res2.status, 400);
    });
  });

  // ── 2. Bookmarks API ──────────────────────────────────────────────────────
  describe('2. Bookmarks API (/api/books/:bookId/bookmarks & /api/bookmarks/:bookmarkId)', () => {
    let userA;
    let userB;
    let bookA;
    let bookmarkA;

    before(async () => {
      userA = suiteUserA;
      userB = suiteUserB;

      const book = await prisma.book.create({
        data: {
          userId: userA.userId,
          title: 'Clean Architecture',
          totalPages: 250,
        },
      });
      bookA = book;
      testBookIds.push(book.id);
    });

    test('8. User A creates a bookmark on page 42 with peacock-feather gold default', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 42,
          label: 'The Dependency Rule',
          color: 'gold',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.bookmark);
      assert.equal(json.bookmark.bookId, bookA.id);
      assert.equal(json.bookmark.page, 42);
      assert.equal(json.bookmark.label, 'The Dependency Rule');
      assert.equal(json.bookmark.color, 'gold');

      bookmarkA = json.bookmark;
    });

    test('9. Duplicate bookmark on same page is rejected with 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 42,
          label: 'Duplicate Attempt',
        }),
      });

      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.error.code, 'BOOKMARK_ALREADY_EXISTS');
    });

    test('10. Bookmark creation validates page number <= book.totalPages', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 999, // bookA has totalPages: 250
        }),
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'PAGE_EXCEEDS_TOTAL');
    });

    test('11. User B cannot view or add bookmarks to User A book', async () => {
      // Attempt to list bookmarks of User A's book
      const resList = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        headers: userB.headers,
      });
      assert.equal(resList.status, 404);

      // Attempt to create bookmark on User A's book
      const resCreate = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        method: 'POST',
        headers: userB.headers,
        body: JSON.stringify({ page: 10 }),
      });
      assert.equal(resCreate.status, 404);
    });

    test('12. User A can update and delete their bookmark; User B cannot', async () => {
      // User B cannot update
      const resB = await fetch(`${baseUrl}/api/bookmarks/${bookmarkA.id}`, {
        method: 'PATCH',
        headers: userB.headers,
        body: JSON.stringify({ label: 'Unauthorized Update' }),
      });
      assert.equal(resB.status, 404);

      // User A updates label & color
      const resA = await fetch(`${baseUrl}/api/bookmarks/${bookmarkA.id}`, {
        method: 'PATCH',
        headers: userA.headers,
        body: JSON.stringify({ label: 'Crucial Architecture Proof', color: 'emerald' }),
      });
      assert.equal(resA.status, 200);
      const jsonA = await resA.json();
      assert.equal(jsonA.bookmark.label, 'Crucial Architecture Proof');
      assert.equal(jsonA.bookmark.color, 'emerald');

      // User A deletes bookmark
      const resDel = await fetch(`${baseUrl}/api/bookmarks/${bookmarkA.id}`, {
        method: 'DELETE',
        headers: userA.headers,
      });
      assert.equal(resDel.status, 200);

      // Verify deletion
      const listAfter = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        headers: userA.headers,
      });
      const listJson = await listAfter.json();
      assert.equal(listJson.bookmarks.length, 0);
    });
  });

  // ── 3. Notes API ──────────────────────────────────────────────────────────
  describe('3. Notes API (/api/notes)', () => {
    let userA;
    let userB;
    let bookA;
    let standaloneNote;
    let bookNote;

    before(async () => {
      userA = suiteUserA;
      userB = suiteUserB;

      const book = await prisma.book.create({
        data: {
          userId: userA.userId,
          title: 'Structure and Interpretation of Computer Programs',
          totalPages: 600,
        },
      });
      bookA = book;
      testBookIds.push(book.id);
    });

    test('13. User A can create a standalone Sanctuary note (no book link)', async () => {
      const res = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Morning Philosophy Reflection',
          content: 'The journey of understanding recursion begins with a single base case.',
          category: 'Reflection',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.note);
      assert.equal(json.note.type, 'STANDALONE');
      assert.equal(json.note.bookId, null);
      assert.equal(json.note.bookTitleSnapshot, null);
      assert.equal(json.note.title, 'Morning Philosophy Reflection');

      standaloneNote = json.note;
    });

    test('14. User A can create a book-linked note preserving bookTitleSnapshot', async () => {
      const res = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Substitution Model Summary',
          content: 'Applicative order vs normal order evaluation.',
          bookId: bookA.id,
          page: 25,
          category: 'Analysis',
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.note);
      assert.equal(json.note.type, 'BOOK');
      assert.equal(json.note.bookId, bookA.id);
      assert.equal(json.note.bookTitleSnapshot, bookA.title);
      assert.equal(json.note.page, 25);

      bookNote = json.note;
    });

    test('15. User B cannot link a note to User A book (404 / Isolation)', async () => {
      const res = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userB.headers,
        body: JSON.stringify({
          title: 'Illicit Note',
          content: 'Trying to link to someone else book.',
          bookId: bookA.id,
        }),
      });

      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error.code, 'BOOK_NOT_FOUND');
    });

    test('16. User B cannot retrieve, update, or delete User A notes', async () => {
      // Get
      const resGet = await fetch(`${baseUrl}/api/notes/${bookNote.id}`, {
        headers: userB.headers,
      });
      assert.equal(resGet.status, 404);

      // Update
      const resPatch = await fetch(`${baseUrl}/api/notes/${bookNote.id}`, {
        method: 'PATCH',
        headers: userB.headers,
        body: JSON.stringify({ title: 'Tampered' }),
      });
      assert.equal(resPatch.status, 404);

      // Delete
      const resDel = await fetch(`${baseUrl}/api/notes/${bookNote.id}`, {
        method: 'DELETE',
        headers: userB.headers,
      });
      assert.equal(resDel.status, 404);
    });

    test('17. User A lists notes with pagination and search', async () => {
      const res = await fetch(`${baseUrl}/api/notes?search=Substitution`, {
        headers: userA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.notes));
      assert.equal(json.notes.length, 1);
      assert.equal(json.notes[0].id, bookNote.id);
    });

    test('18. Deleting a book retains the note with its bookTitleSnapshot intact', async () => {
      // Create temporary book and note
      const tempBook = await prisma.book.create({
        data: {
          userId: userA.userId,
          title: 'Volatile Book',
        },
      });
      testBookIds.push(tempBook.id);

      const noteRes = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          title: 'Preserved Snapshot Note',
          content: 'This note should survive the book deletion.',
          bookId: tempBook.id,
        }),
      });
      const noteJson = await noteRes.json();
      const createdNoteId = noteJson.note.id;

      // Delete the book
      const delBookRes = await fetch(`${baseUrl}/api/books/${tempBook.id}`, {
        method: 'DELETE',
        headers: userA.headers,
      });
      assert.equal(delBookRes.status, 200);

      // Verify the note still exists with bookId: null, but bookTitleSnapshot: 'Volatile Book'
      const checkNoteRes = await fetch(`${baseUrl}/api/notes/${createdNoteId}`, {
        headers: userA.headers,
      });
      assert.equal(checkNoteRes.status, 200);
      const checkNoteJson = await checkNoteRes.json();
      assert.equal(checkNoteJson.note.bookId, null);
      assert.equal(checkNoteJson.note.bookTitleSnapshot, 'Volatile Book');
    });
  });

  // ── 4. Highlights API ─────────────────────────────────────────────────────
  describe('4. Highlights API (/api/books/:bookId/highlights & /api/highlights/:highlightId)', () => {
    let userA;
    let userB;
    let bookA;
    let highlightA;

    before(async () => {
      userA = suiteUserA;
      userB = suiteUserB;

      const book = await prisma.book.create({
        data: {
          userId: userA.userId,
          title: 'Introduction to Algorithms',
          totalPages: 1200,
        },
      });
      bookA = book;
      testBookIds.push(book.id);
    });

    test('19. User A creates a highlight with text, page, color, and coordinates (positionJson)', async () => {
      const positionData = {
        boundingRect: { top: 100, left: 150, width: 300, height: 20 },
        rects: [{ top: 100, left: 150, width: 300, height: 20 }],
      };

      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 15,
          text: 'An algorithm is any well-defined computational procedure.',
          color: 'indigo',
          positionJson: positionData,
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.highlight);
      assert.equal(json.highlight.bookId, bookA.id);
      assert.equal(json.highlight.page, 15);
      assert.equal(json.highlight.color, 'indigo');
      assert.deepEqual(json.highlight.positionJson, positionData);

      highlightA = json.highlight;
    });

    test('20. User B cannot list, update, or delete User A highlights', async () => {
      // List
      const resList = await fetch(`${baseUrl}/api/books/${bookA.id}/highlights`, {
        headers: userB.headers,
      });
      assert.equal(resList.status, 404);

      // Update
      const resPatch = await fetch(`${baseUrl}/api/highlights/${highlightA.id}`, {
        method: 'PATCH',
        headers: userB.headers,
        body: JSON.stringify({ color: 'rose' }),
      });
      assert.equal(resPatch.status, 404);

      // Delete
      const resDel = await fetch(`${baseUrl}/api/highlights/${highlightA.id}`, {
        method: 'DELETE',
        headers: userB.headers,
      });
      assert.equal(resDel.status, 404);
    });

    test('21. Highlight validation rejects empty text or invalid colors', async () => {
      const res1 = await fetch(`${baseUrl}/api/books/${bookA.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 1,
          text: '   ',
        }),
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/books/${bookA.id}/highlights`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({
          page: 1,
          text: 'Valid text',
          color: 'neon-purple-invalid',
        }),
      });
      assert.equal(res2.status, 400);
    });

    test('22. User A updates and deletes highlight successfully', async () => {
      const resUpdate = await fetch(`${baseUrl}/api/highlights/${highlightA.id}`, {
        method: 'PATCH',
        headers: userA.headers,
        body: JSON.stringify({ color: 'amber' }),
      });
      assert.equal(resUpdate.status, 200);
      const jsonUpdate = await resUpdate.json();
      assert.equal(jsonUpdate.highlight.color, 'amber');

      const resDel = await fetch(`${baseUrl}/api/highlights/${highlightA.id}`, {
        method: 'DELETE',
        headers: userA.headers,
      });
      assert.equal(resDel.status, 200);
    });
  });

  // ── 5. Reading Progress API (Single Source of Truth) ──────────────────────
  describe('5. Reading Progress API (/api/books/:bookId/progress)', () => {
    let userA;
    let userB;
    let bookA;

    before(async () => {
      userA = suiteUserA;
      userB = suiteUserB;

      const book = await prisma.book.create({
        data: {
          userId: userA.userId,
          title: 'The Pragmatic Programmer',
          totalPages: 100,
          status: 'UNREAD',
        },
      });
      bookA = book;
      testBookIds.push(book.id);
    });

    test('23. Unread book initially returns default progress (page 1, 0%)', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        headers: userA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.progress.currentPage, 1);
      assert.equal(json.progress.progressPercent, 0);
    });

    test('24. User A updates reading progress to page 50 (50%); status becomes IN_PROGRESS', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 50 }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.progress.currentPage, 50);
      assert.equal(json.progress.progressPercent, 50);
      assert.ok(json.progress.lastOpenedAt);
      assert.equal(typeof json.progress.lastOpenedTimestamp, 'number');

      // Verify book status transitioned in DB
      const dbBook = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBook.status, 'IN_PROGRESS');
    });

    test('25. Sequential progress updates update the SAME record (no duplicates)', async () => {
      await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 75 }),
      });

      const count = await prisma.readingProgress.count({
        where: { bookId: bookA.id, userId: userA.userId },
      });
      assert.equal(count, 1, 'Exactly one ReadingProgress record must exist per book/user');

      const getRes = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        headers: userA.headers,
      });
      const getJson = await getRes.json();
      assert.equal(getJson.progress.currentPage, 75);
      assert.equal(getJson.progress.progressPercent, 75);
    });

    test('26. Progress reaches totalPages (100) -> status transitions to FINISHED', async () => {
      await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 100 }),
      });

      const dbBook = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBook.status, 'FINISHED');
    });

    test('26a. FINISHED -> IN_PROGRESS when moving backwards', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 50 }),
      });
      assert.equal(res.status, 200);

      const dbBook = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBook.status, 'IN_PROGRESS');
    });

    test('26b. FINISHED -> IN_PROGRESS when reopening at page 1', async () => {
      // 1. Move to page 100 -> FINISHED
      await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 100 }),
      });
      const dbBookFinished = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBookFinished.status, 'FINISHED');

      // 2. Reopen at page 1 -> IN_PROGRESS
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 1 }),
      });
      assert.equal(res.status, 200);

      const dbBookReopened = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBookReopened.status, 'IN_PROGRESS');
    });

    test('26c. IN_PROGRESS remains IN_PROGRESS when moving back to page 1', async () => {
      // 1. Move to page 25 -> IN_PROGRESS
      await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 25 }),
      });
      const dbBookMid = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBookMid.status, 'IN_PROGRESS');

      // 2. Move to page 1 -> remains IN_PROGRESS
      await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 1 }),
      });
      const dbBookP1 = await prisma.book.findUnique({ where: { id: bookA.id } });
      assert.equal(dbBookP1.status, 'IN_PROGRESS');
    });

    test('26d. One-page book transitions to FINISHED when page 1 is saved', async () => {
      const onePageBook = await prisma.book.create({
        data: {
          userId: userA.userId,
          title: 'Single Page Manifesto',
          totalPages: 1,
          status: 'UNREAD',
        },
      });
      testBookIds.push(onePageBook.id);

      // Verify unopened book returns virtual default without inserting DB record
      const getRes = await fetch(`${baseUrl}/api/books/${onePageBook.id}/progress`, {
        headers: userA.headers,
      });
      const getJson = await getRes.json();
      assert.equal(getJson.progress.currentPage, 1);
      assert.equal(getJson.progress.progressPercent, 0);

      const dbCountBefore = await prisma.readingProgress.count({
        where: { bookId: onePageBook.id },
      });
      assert.equal(dbCountBefore, 0, 'No DB record should exist before saving progress');

      // Save page 1 -> transitions to FINISHED with 100%
      const putRes = await fetch(`${baseUrl}/api/books/${onePageBook.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 1 }),
      });
      assert.equal(putRes.status, 200);
      const putJson = await putRes.json();
      assert.equal(putJson.progress.progressPercent, 100);

      const dbBook = await prisma.book.findUnique({ where: { id: onePageBook.id } });
      assert.equal(dbBook.status, 'FINISHED');
    });


    test('27. Reading progress does NOT overwrite bookmarks or create separate Book column', async () => {
      // 1. Create a bookmark on page 20
      const bmRes = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        method: 'POST',
        headers: userA.headers,
        body: JSON.stringify({ page: 20, label: 'Page 20 Marker' }),
      });
      assert.equal(bmRes.status, 201);

      // 2. Update reading progress to page 30
      await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 30 }),
      });

      // 3. Confirm bookmark on page 20 is still intact
      const bmList = await fetch(`${baseUrl}/api/books/${bookA.id}/bookmarks`, {
        headers: userA.headers,
      });
      const bmJson = await bmList.json();
      assert.equal(bmJson.bookmarks.length, 1);
      assert.equal(bmJson.bookmarks[0].page, 20);

      // 4. Confirm reading progress is page 30
      const progRes = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        headers: userA.headers,
      });
      const progJson = await progRes.json();
      assert.equal(progJson.progress.currentPage, 30);
    });

    test('28. User B cannot read or update User A reading progress', async () => {
      const getRes = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        headers: userB.headers,
      });
      assert.equal(getRes.status, 404);

      const putRes = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userB.headers,
        body: JSON.stringify({ currentPage: 10 }),
      });
      assert.equal(putRes.status, 404);
    });

    test('29. Invalid page number (> totalPages or < 1) is rejected with 400', async () => {
      const res1 = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 0 }),
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/books/${bookA.id}/progress`, {
        method: 'PUT',
        headers: userA.headers,
        body: JSON.stringify({ currentPage: 9999 }),
      });
      assert.equal(res2.status, 400);
    });
  });

  // ── 6. Full Lifecycle, Physical PDF Cleanup & Cascade Tests ───────────────
  describe('6. Cascade & PDF File Deletion Lifecycle', () => {
    test('30. Deleting a book cascades to its bookmarks, highlights, progress, and deletes physical PDF file', async () => {
      const user = suiteUserA;

      // 1. Create a book
      const bookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: user.headers,
        body: JSON.stringify({ title: 'Lifecycle Target Volume', totalPages: 50 }),
      });
      const { book } = await bookRes.json();
      testBookIds.push(book.id);

      // 2. Upload valid PDF
      const pdfBuffer = await createValidPdf('Physical PDF content for lifecycle test');
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'lifecycle.pdf');

      const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.cookie}`,
          'X-CSRF-Token': user.csrfToken,
        },
        body: form,
      });
      assert.equal(uploadRes.status, 200);

      // Verify physical file was placed on disk
      const dbFile = await prisma.bookFile.findUnique({ where: { bookId: book.id } });
      assert.ok(dbFile);
      const physicalPath = path.resolve(storagePaths.root, dbFile.storagePath);
      assert.ok(fs.existsSync(physicalPath), 'Physical PDF must exist on disk');

      // 3. Add bookmark, highlight, and reading progress
      await fetch(`${baseUrl}/api/books/${book.id}/bookmarks`, {
        method: 'POST',
        headers: user.headers,
        body: JSON.stringify({ page: 10, label: 'BM 10' }),
      });

      await fetch(`${baseUrl}/api/books/${book.id}/highlights`, {
        method: 'POST',
        headers: user.headers,
        body: JSON.stringify({ page: 12, text: 'Highlighted sentence.' }),
      });

      await fetch(`${baseUrl}/api/books/${book.id}/progress`, {
        method: 'PUT',
        headers: user.headers,
        body: JSON.stringify({ currentPage: 25 }),
      });

      // 4. Delete the book
      const delRes = await fetch(`${baseUrl}/api/books/${book.id}`, {
        method: 'DELETE',
        headers: user.headers,
      });
      assert.equal(delRes.status, 200);

      // 5. Verify database records are cascaded
      const bookCheck = await prisma.book.findUnique({ where: { id: book.id } });
      assert.equal(bookCheck, null);

      const fileCheck = await prisma.bookFile.findUnique({ where: { bookId: book.id } });
      assert.equal(fileCheck, null);

      const bmCount = await prisma.bookmark.count({ where: { bookId: book.id } });
      assert.equal(bmCount, 0);

      const hlCount = await prisma.highlight.count({ where: { bookId: book.id } });
      assert.equal(hlCount, 0);

      const progCount = await prisma.readingProgress.count({ where: { bookId: book.id } });
      assert.equal(progCount, 0);

      // 6. Verify physical PDF file was cleaned up from disk
      assert.equal(fs.existsSync(physicalPath), false, 'Physical PDF must be removed from storage upon book deletion');
    });
  });

  // ── 7. Shared Mutex & Upload/Deletion Concurrency ──────────────────────────
  describe('7. Shared Mutex & Upload/Deletion Concurrency', () => {
    test('31. Deletion waits when an upload or critical section holds the shared lock', async () => {
      const user = suiteUserA;
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Lock Concurrency Book', totalPages: 10 },
      });
      testBookIds.push(book.id);

      let lockAcquired = false;
      let resolveLock;
      const lockHoldPromise = new Promise((resolve) => {
        resolveLock = resolve;
      });

      // Start an operation holding the per-book lock
      const holdingPromise = withBookLock(book.id, async () => {
        lockAcquired = true;
        await lockHoldPromise;
      });

      // Wait a microtask tick for lock acquisition
      await new Promise((r) => setImmediate(r));
      assert.equal(lockAcquired, true, 'Lock must be held');

      // Now issue a DELETE request while lock is held
      let deleteCompleted = false;
      const deletePromise = fetch(`${baseUrl}/api/books/${book.id}`, {
        method: 'DELETE',
        headers: user.headers,
      }).then((res) => {
        deleteCompleted = true;
        return res;
      });

      // Ensure delete request is in flight and blocked waiting for lock
      await new Promise((r) => setImmediate(r));
      assert.equal(deleteCompleted, false, 'Delete request must be blocked while lock is held');

      // Verify the book still exists in DB while lock is held
      const bookWhileLocked = await prisma.book.findUnique({ where: { id: book.id } });
      assert.ok(bookWhileLocked, 'Book must not be deleted while lock is held');

      // Release the lock
      resolveLock();
      await holdingPromise;

      // Now wait for delete request to complete
      const delRes = await deletePromise;
      assert.equal(delRes.status, 200);
      assert.equal(deleteCompleted, true);

      // Verify book is now deleted from DB
      const bookAfter = await prisma.book.findUnique({ where: { id: book.id } });
      assert.equal(bookAfter, null);
    });

    test('32. An upload attempting promotion after book deletion fails safely without orphan files', async () => {
      const user = suiteUserA;
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Late Upload Target', totalPages: 10 },
      });
      testBookIds.push(book.id);

      // Delete the book first
      const delRes = await fetch(`${baseUrl}/api/books/${book.id}`, {
        method: 'DELETE',
        headers: user.headers,
      });
      assert.equal(delRes.status, 200);

      // Now attempt to upload to the deleted book
      const pdfBuffer = await createValidPdf('Late upload content');
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'late.pdf');

      const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.cookie}`,
          'X-CSRF-Token': user.csrfToken,
        },
        body: form,
      });

      assert.equal(uploadRes.status, 404);
      const json = await uploadRes.json();
      assert.equal(json.error.code, 'BOOK_NOT_FOUND');

      // Verify no temporary files remain in storage/temp
      const tempFiles = fs.readdirSync(storagePaths.temp).filter((f) => f.startsWith('upload_'));
      assert.equal(tempFiles.length, 0, 'No temporary upload files should remain');
    });

    test('33. A failed database deletion does not remove the physical PDF file', async () => {
      const user = suiteUserA;
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Fail Safe Book', totalPages: 20 },
      });
      testBookIds.push(book.id);

      // Upload valid PDF
      const pdfBuffer = await createValidPdf('Fail safe PDF content');
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'failsafe.pdf');

      const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.cookie}`,
          'X-CSRF-Token': user.csrfToken,
        },
        body: form,
      });
      assert.equal(uploadRes.status, 200);

      const dbFile = await prisma.bookFile.findUnique({ where: { bookId: book.id } });
      assert.ok(dbFile);
      const physicalPath = path.resolve(storagePaths.root, dbFile.storagePath);
      assert.ok(fs.existsSync(physicalPath), 'Physical PDF must exist before deletion attempt');

      // Simulate database deletion failure by temporarily stubbing prisma.book.delete
      const origDelete = prisma.book.delete;
      prisma.book.delete = async () => {
        throw new Error('Simulated database deletion failure');
      };

      try {
        const delRes = await fetch(`${baseUrl}/api/books/${book.id}`, {
          method: 'DELETE',
          headers: user.headers,
        });
        assert.equal(delRes.status, 500);

        // Physical PDF must NOT be deleted because DB deletion failed
        assert.ok(fs.existsSync(physicalPath), 'Physical PDF must still exist on disk when DB deletion fails');
      } finally {
        prisma.book.delete = origDelete;
      }
    });

    test('34. The shared lock is released cleanly after both successful and failed operations', async () => {
      const testLockId = 'test-lock-' + crypto.randomUUID();

      // 1. Successful execution releases lock
      await withBookLock(testLockId, async () => {
        return 'success';
      });

      // 2. Failed execution releases lock
      let threw = false;
      try {
        await withBookLock(testLockId, async () => {
          throw new Error('Forced lock failure');
        });
      } catch (err) {
        threw = true;
        assert.equal(err.message, 'Forced lock failure');
      }
      assert.equal(threw, true);

      // 3. Immediately able to acquire lock again
      const result = await withBookLock(testLockId, async () => {
        return 'lock reacquired cleanly';
      });
      assert.equal(result, 'lock reacquired cleanly');
    });
  });
});
