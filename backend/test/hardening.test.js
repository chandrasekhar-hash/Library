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
import { deleteStoredFile, validatePdfStructure } from '../src/services/storageService.js';

describe('Aks (अक्स) Phase 3 Final Hardening Test Suite', () => {
  let server;
  let baseUrl;

  const testUserIds = [];
  const testBookIds = [];
  const createdPhysicalFiles = [];

  // Helper to extract session cookie
  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Helper to create valid PDF buffer using pdf-lib
  async function createValidPdf(text = 'Aks PDF Document') {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText(text, { x: 20, y: 100 });
    return Buffer.from(await doc.save());
  }

  // Helper to register and log in a test user with guaranteed unique email
  async function createAuthenticatedUser(name, email, password) {
    const uniqueEmail = email.replace('@', `+${crypto.randomUUID().slice(0, 8)}@`);
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
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'X-CSRF-Token': authCsrf,
      },
    };
  }

  before(async () => {
    initStorage();
    if (fs.existsSync(storagePaths.temp)) {
      const files = fs.readdirSync(storagePaths.temp);
      for (const f of files) {
        if (f.startsWith('upload_')) {
          try {
            fs.unlinkSync(path.join(storagePaths.temp, f));
          } catch {
            // ignore
          }
        }
      }
    }
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
        } catch {
          // ignore
        }
      }
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // ── 1. Restrict Private Storage Permissions ────────────────────────────────
  describe('1. Private Storage Permissions Enforcement (0700 dir / 0600 file)', () => {
    test('Storage root, pdfs, and temp directories have 0700 permissions', () => {
      const checkDirMode = (dirPath) => {
        const stat = fs.statSync(dirPath);
        const mode = stat.mode & 0o777;
        assert.equal(mode, 0o700, `Directory ${dirPath} must have 0700 permissions, got 0${mode.toString(8)}`);
      };

      checkDirMode(storagePaths.root);
      checkDirMode(storagePaths.pdfs);
      checkDirMode(storagePaths.temp);
    });

    test('User directory has 0700 and uploaded PDF file has 0600 permissions', async () => {
      const user = await createAuthenticatedUser('Perm User', 'perm.user@example.com', 'PermPassword1!');
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Permissions Test Book' },
      });
      testBookIds.push(book.id);

      const pdfBuffer = await createValidPdf('Permissions verification');
      const form = new FormData();
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'perm.pdf');

      const res = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: user.headers,
        body: form,
      });

      assert.equal(res.status, 200);
      const dbFile = await prisma.bookFile.findUnique({ where: { bookId: book.id } });
      assert.ok(dbFile);
      createdPhysicalFiles.push(dbFile.storagePath);

      const userDir = path.join(storagePaths.pdfs, user.userId);
      const userDirStat = fs.statSync(userDir);
      const userDirMode = userDirStat.mode & 0o777;
      assert.equal(userDirMode, 0o700, `User storage directory must have 0700 mode, got 0${userDirMode.toString(8)}`);

      const physicalPath = path.resolve(storagePaths.root, dbFile.storagePath);
      const fileStat = fs.statSync(physicalPath);
      const fileMode = fileStat.mode & 0o777;
      assert.equal(fileMode, 0o600, `Uploaded PDF file must have 0600 mode, got 0${fileMode.toString(8)}`);
    });
  });

  // ── 2. Add Multipart Resource Limits ───────────────────────────────────────
  describe('2. Multipart Resource Limits (Busboy)', () => {
    let limitUser;
    let limitBook;

    before(async () => {
      limitUser = await createAuthenticatedUser('Limit User', 'limit.user@example.com', 'LimitPassword1!');
      limitBook = await prisma.book.create({
        data: { userId: limitUser.userId, title: 'Limits Test Book' },
      });
      testBookIds.push(limitBook.id);
    });

    test('Rejects request with multiple files (files limit: 1) with HTTP 400', async () => {
      const pdfBuffer = await createValidPdf('Multiple files check');
      const form = new FormData();
      form.append('file1', new Blob([pdfBuffer], { type: 'application/pdf' }), 'first.pdf');
      form.append('file2', new Blob([pdfBuffer], { type: 'application/pdf' }), 'second.pdf');

      const res = await fetch(`${baseUrl}/api/books/${limitBook.id}/file`, {
        method: 'POST',
        headers: limitUser.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'LIMIT_FILE_COUNT');
    });

    test('Rejects request exceeding 10 form fields with HTTP 400', async () => {
      const pdfBuffer = await createValidPdf('Field limit check');
      const form = new FormData();
      // Append 12 fields (limit is 10)
      for (let i = 1; i <= 12; i++) {
        form.append(`custom_field_${i}`, `value_${i}`);
      }
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'fields.pdf');

      const res = await fetch(`${baseUrl}/api/books/${limitBook.id}/file`, {
        method: 'POST',
        headers: limitUser.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'LIMIT_FIELD_COUNT');
    });

    test('Rejects request exceeding 20 multipart parts with HTTP 400', async () => {
      const pdfBuffer = await createValidPdf('Part limit check');
      const form = new FormData();
      // Append 22 parts (limit is 20)
      for (let i = 1; i <= 22; i++) {
        form.append(`field_${i}`, `data_${i}`);
      }
      form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'parts.pdf');

      const res = await fetch(`${baseUrl}/api/books/${limitBook.id}/file`, {
        method: 'POST',
        headers: limitUser.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.ok(json.error.code === 'LIMIT_PART_COUNT' || json.error.code === 'LIMIT_FIELD_COUNT');
    });

    test('Temporary files are cleaned up after multipart limit rejection', async () => {
      const tempFiles = fs.readdirSync(storagePaths.temp);
      const remainingUploadTemps = tempFiles.filter((f) => f.startsWith('upload_'));
      assert.equal(remainingUploadTemps.length, 0, 'No temporary upload files should remain in storage/temp');
    });
  });

  // ── 3. Completed PDF Validation ───────────────────────────────────────────
  describe('3. Completed PDF Structural Validation', () => {
    let valUser;
    let valBook;

    before(async () => {
      valUser = await createAuthenticatedUser('Val User', 'val.user@example.com', 'ValPassword1!');
      valBook = await prisma.book.create({
        data: { userId: valUser.userId, title: 'Validation Test Book' },
      });
      testBookIds.push(valBook.id);
    });

    test('Valid complete PDF is accepted and verified', async () => {
      const validPdf = await createValidPdf('Thorough structural validity test');
      const form = new FormData();
      form.append('file', new Blob([validPdf], { type: 'application/pdf' }), 'valid_doc.pdf');

      const res = await fetch(`${baseUrl}/api/books/${valBook.id}/file`, {
        method: 'POST',
        headers: valUser.headers,
        body: form,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.file);
      assert.equal(json.file.filename, 'valid_doc.pdf');
    });

    test('Truncated PDF beginning with %PDF- is rejected before permanent placement (400)', async () => {
      // 30 bytes: has %PDF-1.4 header but cut off abruptly
      const truncatedPdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Ca');
      const form = new FormData();
      form.append('file', new Blob([truncatedPdf], { type: 'application/pdf' }), 'truncated.pdf');

      const res = await fetch(`${baseUrl}/api/books/${valBook.id}/file`, {
        method: 'POST',
        headers: valUser.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'INVALID_PDF_STRUCTURE');

      // Verify no orphan temp files
      const tempFiles = fs.readdirSync(storagePaths.temp);
      assert.equal(tempFiles.filter((f) => f.startsWith('upload_')).length, 0);
    });

    test('Corrupted PDF beginning with %PDF- is rejected before permanent placement (400)', async () => {
      const corruptedPdf = Buffer.from(
        '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << CORRUPTED DATA JUNK \n%%EOF'
      );
      const form = new FormData();
      form.append('file', new Blob([corruptedPdf], { type: 'application/pdf' }), 'corrupted.pdf');

      const res = await fetch(`${baseUrl}/api/books/${valBook.id}/file`, {
        method: 'POST',
        headers: valUser.headers,
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'INVALID_PDF_STRUCTURE');

      // Verify no orphan temp files
      const tempFiles = fs.readdirSync(storagePaths.temp);
      assert.equal(tempFiles.filter((f) => f.startsWith('upload_')).length, 0);
    });
  });

  // ── 4. Concurrent Replacement & Orphan File Elimination ────────────────────
  describe('4. Concurrent Replacement Safety & Orphan File Prevention', () => {
    test('Concurrent uploads to the same book leave exactly 1 physical file matching DB', async () => {
      const user = await createAuthenticatedUser('Race User', 'race.user@example.com', 'RacePassword1!');
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Race Condition Book' },
      });
      testBookIds.push(book.id);

      const pdf1 = await createValidPdf('Race Version 1');
      const pdf2 = await createValidPdf('Race Version 2');

      const form1 = new FormData();
      form1.append('file', new Blob([pdf1], { type: 'application/pdf' }), 'version1.pdf');

      const form2 = new FormData();
      form2.append('file', new Blob([pdf2], { type: 'application/pdf' }), 'version2.pdf');

      // Send both requests concurrently
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/books/${book.id}/file`, {
          method: 'POST',
          headers: user.headers,
          body: form1,
        }),
        fetch(`${baseUrl}/api/books/${book.id}/file`, {
          method: 'POST',
          headers: user.headers,
          body: form2,
        }),
      ]);

      assert.equal(res1.status, 200, 'Upload 1 must succeed');
      assert.equal(res2.status, 200, 'Upload 2 must succeed');

      // Inspect DB state
      const finalDbFile = await prisma.bookFile.findUnique({
        where: { bookId: book.id },
      });
      assert.ok(finalDbFile);
      createdPhysicalFiles.push(finalDbFile.storagePath);

      // Inspect physical storage folder for this user
      const userDir = path.join(storagePaths.pdfs, user.userId);
      const filesInUserDir = fs.readdirSync(userDir);

      // Exactly 1 physical file should exist in the directory, and it must match finalDbFile!
      assert.equal(
        filesInUserDir.length,
        1,
        `Expected exactly 1 file in user directory after concurrent replacement, found ${filesInUserDir.length}`
      );
      assert.equal(
        path.join('pdfs', user.userId, filesInUserDir[0]),
        finalDbFile.storagePath,
        'Physical file on disk must exactly match database storagePath'
      );
    });

    test('Failed upload preserves existing valid file and cleans up failed upload artifacts', async () => {
      const user = await createAuthenticatedUser('Fail User', 'fail.user@example.com', 'FailPassword1!');
      const book = await prisma.book.create({
        data: { userId: user.userId, title: 'Fail Safe Book' },
      });
      testBookIds.push(book.id);

      // 1. Initial valid upload
      const validPdf = await createValidPdf('Original valid content');
      const form1 = new FormData();
      form1.append('file', new Blob([validPdf], { type: 'application/pdf' }), 'original.pdf');

      const res1 = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: user.headers,
        body: form1,
      });
      assert.equal(res1.status, 200);

      const initialDbFile = await prisma.bookFile.findUnique({ where: { bookId: book.id } });
      assert.ok(initialDbFile);
      const initialPhysicalPath = path.resolve(storagePaths.root, initialDbFile.storagePath);
      assert.ok(fs.existsSync(initialPhysicalPath), 'Initial file must exist');

      // 2. Replacement upload with corrupted PDF
      const badPdf = Buffer.from('%PDF-1.4\nJUNK CORRUPTED DATA');
      const form2 = new FormData();
      form2.append('file', new Blob([badPdf], { type: 'application/pdf' }), 'corrupted.pdf');

      const res2 = await fetch(`${baseUrl}/api/books/${book.id}/file`, {
        method: 'POST',
        headers: user.headers,
        body: form2,
      });
      assert.equal(res2.status, 400);

      // 3. Confirm original file is still referenced in DB and still physically exists
      const postDbFile = await prisma.bookFile.findUnique({ where: { bookId: book.id } });
      assert.equal(postDbFile.storagePath, initialDbFile.storagePath);
      assert.ok(fs.existsSync(initialPhysicalPath), 'Original physical file must remain intact');

      // 4. Confirm no orphaned temp files
      const tempFiles = fs.readdirSync(storagePaths.temp);
      assert.equal(tempFiles.filter((f) => f.startsWith('upload_')).length, 0);
    });
  });

  // ── 5. Prevent Unnecessary Anonymous Health Sessions ──────────────────────
  describe('5. Health Endpoint Session Independence', () => {
    test('/api/health returns 200 and does NOT create anonymous session in PostgreSQL', async () => {
      // 1. Query current session count in PostgreSQL
      const sessionsBefore = await prisma.session.count();

      // 2. Request health check without any cookies
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.status, 'healthy');
      assert.equal(json.database.connected, true);

      // 3. Confirm no Set-Cookie header is sent
      const setCookie = res.headers.get('set-cookie');
      assert.equal(setCookie, null, 'Health check must not set session cookie');

      // 4. Query session count in PostgreSQL after health check
      const sessionsAfter = await prisma.session.count();
      assert.equal(
        sessionsAfter,
        sessionsBefore,
        `Health check must not create session records. Before: ${sessionsBefore}, After: ${sessionsAfter}`
      );
    });
  });
});
