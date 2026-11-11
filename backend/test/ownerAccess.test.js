import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { AccountRelationshipService } from '../src/services/accountRelationshipService.js';
import { storagePaths } from '../src/config/storage.js';
import fs from 'fs';
import path from 'path';

describe('Aks (अक्स) Phase ACCOUNT-1B: Separate Owner-Authorized Account Access Test Suite', () => {
  let server;
  let baseUrl;
  const createdUserIds = [];

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Helper to register and log in a user, returning auth headers
  async function createAuthenticatedUser(name, email, password = 'Password123!', role = null) {
    // 1. Initial CSRF
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const { csrfToken: regCsrf } = await csrfRes.json();
    let currentCookie = extractCookie(csrfRes);

    // 2. Register
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${currentCookie}`,
        'X-CSRF-Token': regCsrf,
      },
      body: JSON.stringify({ name, email, password }),
    });

    const regData = await regRes.json();
    assert.equal(regRes.status, 201, `Registration failed: ${JSON.stringify(regData)}`);
    const userId = regData.user.id;
    createdUserIds.push(userId);

    const postRegCookie = extractCookie(regRes);
    if (postRegCookie) currentCookie = postRegCookie;

    // Fresh CSRF before login
    const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${currentCookie}` },
    });
    const { csrfToken: loginCsrf } = await loginCsrfRes.json();
    const postCsrfCookie = extractCookie(loginCsrfRes);
    if (postCsrfCookie) currentCookie = postCsrfCookie;

    // Direct DB update for test role setup if needed
    if (role && role !== 'USER') {
      await prisma.user.update({
        where: { id: userId },
        data: { role },
      });
    }

    // 3. Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${currentCookie}`,
        'X-CSRF-Token': loginCsrf,
      },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginRes.status, 200, 'Login failed');
    const loginData = await loginRes.json();
    const authCookie = extractCookie(loginRes);

    return {
      userId,
      email,
      name,
      authCookie,
      csrfToken: loginData.csrfToken,
      user: loginData.user,
    };
  }

  // Helper to refresh CSRF token for an existing session
  async function getCsrf(authCookie) {
    const res = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    const data = await res.json();
    return data.csrfToken;
  }

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await prisma.ownerAccessContext.deleteMany({
        where: {
          OR: [
            { ownerId: { in: createdUserIds } },
            { targetUserId: { in: createdUserIds } },
          ],
        },
      }).catch(() => {});

      await prisma.accountRelationship.deleteMany({
        where: {
          OR: [
            { ownerId: { in: createdUserIds } },
            { userId: { in: createdUserIds } },
          ],
        },
      }).catch(() => {});

      await prisma.bookFile.deleteMany({
        where: { userId: { in: createdUserIds } },
      }).catch(() => {});

      await prisma.book.deleteMany({
        where: { userId: { in: createdUserIds } },
      }).catch(() => {});

      await prisma.note.deleteMany({
        where: { userId: { in: createdUserIds } },
      }).catch(() => {});

      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      }).catch(() => {});
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
  });

  describe('1. Owner Access Initiation & Validation', () => {
    test('1. Normal User cannot start owner access (403 Forbidden)', async () => {
      const normalUser = await createAuthenticatedUser('User One', `u1_${Date.now()}@example.com`);
      const targetUser = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);
      const csrf = await getCsrf(normalUser.authCookie);

      const res = await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${normalUser.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: targetUser.userId }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'FORBIDDEN_ROLE_REQUIRED');
    });

    test('2. Owner cannot access an unlinked account (403 Conflict/Forbidden)', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const unlinkedUser = await createAuthenticatedUser('Stranger', `stranger_${Date.now()}@example.com`);
      const csrf = await getCsrf(owner.authCookie);

      const res = await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: unlinkedUser.userId }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'ACTIVE_RELATIONSHIP_REQUIRED');
    });

    test('3. Owner can access an ACTIVE linked User with safe context metadata', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      // Link user first
      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      const csrf = await getCsrf(owner.authCookie);
      const res = await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.accessContext);
      assert.equal(data.accessContext.targetUser.id, linkedUser.userId);
      assert.equal(data.accessContext.status, 'ACTIVE');

      // Check current endpoint
      const curRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(curRes.status, 200);
      const curData = await curRes.json();
      assert.equal(curData.active, true);
      assert.equal(curData.accessContext.targetUser.id, linkedUser.userId);
    });

    test('4. Revoked relationship immediately invalidates access', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      const rel = await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      // Revoke the relationship
      await AccountRelationshipService.revokeRelationship({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      // Context must be invalidated now
      const curRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      const curData = await curRes.json();
      assert.equal(curData.active, false);
    });
  });

  describe('2. Session Isolation & Context Lifecycle', () => {
    test('5. Original Owner session remains unchanged', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      // Verify /api/auth/me still reports the OWNER's identity
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(meRes.status, 200);
      const meData = await meRes.json();
      assert.equal(meData.user.id, owner.userId);
      assert.equal(meData.user.role, 'OWNER');
    });

    test('6. Target User session remains unchanged and concurrent', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const targetUser = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: targetUser.userId,
      });

      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: targetUser.userId }),
      });

      // Target user can still make requests seamlessly
      const targetMeRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${targetUser.authCookie}` },
      });
      assert.equal(targetMeRes.status, 200);
      const targetMe = await targetMeRes.json();
      assert.equal(targetMe.user.id, targetUser.userId);
    });

    test('7. Owner access expires when owner session is destroyed', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      // Simulate session destruction in PostgreSQL
      await prisma.session.deleteMany({
        where: { userId: owner.userId },
      });

      const checkRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(checkRes.status, 401);
    });

    test('8. Access cannot be reused after explicit exit', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      let csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      // Exit owner access
      csrf = await getCsrf(owner.authCookie);
      const exitRes = await fetch(`${baseUrl}/api/account/owner-access/exit`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
      });
      assert.equal(exitRes.status, 200);

      // Verify current status is false
      const curRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      const curData = await curRes.json();
      assert.equal(curData.active, false);
    });

    test('9. Access cannot be reused after logout', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      let csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      // Logout
      csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
      });

      // Trying with old cookie returns 401
      const res = await fetch(`${baseUrl}/api/account/owner-access/current`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(res.status, 401);
    });

    test('10. Access cannot survive an unrelated new login session', async () => {
      const email = `owner_${Date.now()}@example.com`;
      const owner = await createAuthenticatedUser('Owner', email, 'Password123!', 'OWNER');
      const linkedUser = await createAuthenticatedUser('Linked', `linked_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: linkedUser.userId,
      });

      let csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: linkedUser.userId }),
      });

      // Perform a fresh new login (generates new session ID)
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const { csrfToken: newCsrf } = await csrfRes.json();
      const freshCookie = extractCookie(csrfRes);

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${freshCookie}`,
          'X-CSRF-Token': newCsrf,
        },
        body: JSON.stringify({ email, password: 'Password123!' }),
      });
      assert.equal(loginRes.status, 200);
      const newAuthCookie = extractCookie(loginRes);

      // The new session must start with no active owner access
      const curRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${newAuthCookie}` },
      });
      const curData = await curRes.json();
      assert.equal(curData.active, false);
    });
  });

  describe('3. Read-Only Enforcement & Data Scoping', () => {
    test('11. Read-only GET requests work for authorized target data', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const target = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);

      // Seed a book for the target user directly in DB
      const targetBook = await prisma.book.create({
        data: {
          userId: target.userId,
          title: 'Target User Diary',
          author: 'Target Author',
          category: 'Philosophy',
          totalPages: 100,
        },
      });

      // Link user
      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: target.userId,
      });

      // Start owner access
      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: target.userId }),
      });

      // GET /api/books should list target user's book
      const booksRes = await fetch(`${baseUrl}/api/books`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(booksRes.status, 200);
      const booksData = await booksRes.json();
      assert.equal(booksData.books.length, 1);
      assert.equal(booksData.books[0].id, targetBook.id);
      assert.equal(booksData.books[0].title, 'Target User Diary');
    });

    test('12. All write operations are rejected in owner-access context (403 OWNER_READ_ONLY_ACCESS)', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const target = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: target.userId,
      });

      let csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: target.userId }),
      });

      csrf = await getCsrf(owner.authCookie);

      // Attempt 1: POST /api/books (create book)
      const postBookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ title: 'Illegal Book' }),
      });
      assert.equal(postBookRes.status, 403);
      const postBookData = await postBookRes.json();
      assert.equal(postBookData.error.code, 'OWNER_READ_ONLY_ACCESS');

      // Attempt 2: POST /api/notes (create note)
      const postNoteRes = await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ title: 'Illegal Note', content: 'Not allowed' }),
      });
      assert.equal(postNoteRes.status, 403);
      const postNoteData = await postNoteRes.json();
      assert.equal(postNoteData.error.code, 'OWNER_READ_ONLY_ACCESS');

      // Attempt 3: PATCH /api/preferences (modify preferences)
      const patchPrefRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ readingConfig: { defaultMode: 'single' } }),
      });
      assert.equal(patchPrefRes.status, 403);
      const patchPrefData = await patchPrefRes.json();
      assert.equal(patchPrefData.error.code, 'OWNER_READ_ONLY_ACCESS');
    });

    test('13. Cross-owner access is rejected', async () => {
      const ownerA = await createAuthenticatedUser('Owner A', `ownerA_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const ownerB = await createAuthenticatedUser('Owner B', `ownerB_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const userA = await createAuthenticatedUser('User A', `userA_${Date.now()}@example.com`);

      // User A is linked to Owner A
      await AccountRelationshipService.linkUser({
        ownerId: ownerA.userId,
        targetUserId: userA.userId,
      });

      // Owner B attempts to start owner access for User A
      const csrf = await getCsrf(ownerB.authCookie);
      const res = await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerB.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: userA.userId }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'ACTIVE_RELATIONSHIP_REQUIRED');
    });

    test('14. PDF streaming and Range requests enforce target ownership', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const target = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);
      const stranger = await createAuthenticatedUser('Stranger', `stranger_${Date.now()}@example.com`);

      // Create dummy PDF in storage
      const pdfBytes = Buffer.from('%PDF-1.4\n%Fake PDF content for range streaming test\n%%EOF');
      const filename = `${Date.now()}_test.pdf`;
      const targetUserDir = path.join(storagePaths.pdfs, target.userId);
      fs.mkdirSync(targetUserDir, { recursive: true });
      fs.writeFileSync(path.join(targetUserDir, filename), pdfBytes);
      const targetStoragePath = path.posix.join('pdfs', target.userId, filename);

      // Create target book with file
      const targetBook = await prisma.book.create({
        data: {
          userId: target.userId,
          title: 'Target Stream Book',
          totalPages: 10,
          file: {
            create: {
              storagePath: targetStoragePath,
              filename: 'target.pdf',
              mimeType: 'application/pdf',
              fileSizeBytes: BigInt(pdfBytes.length),
            },
          },
        },
      });

      // Create stranger book
      const strangerBook = await prisma.book.create({
        data: {
          userId: stranger.userId,
          title: 'Stranger Book',
          totalPages: 5,
        },
      });

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: target.userId,
      });

      // Start owner access
      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: target.userId }),
      });

      // Stream target book with Range header -> 206
      const rangeRes = await fetch(`${baseUrl}/api/books/${targetBook.id}/file`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          Range: 'bytes=0-10',
        },
      });
      assert.equal(rangeRes.status, 206);
      assert.equal(rangeRes.headers.get('content-range'), `bytes 0-10/${pdfBytes.length}`);

      // Attempt to stream stranger book -> 404
      const strangerRes = await fetch(`${baseUrl}/api/books/${strangerBook.id}/file`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(strangerRes.status, 404);
    });

    test('15. Notes and journal visibility respects the target account', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const target = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);

      // Create owner note
      await prisma.note.create({
        data: {
          userId: owner.userId,
          title: 'Owner Private Note',
          content: 'Owner secret',
          type: 'STANDALONE',
        },
      });

      // Create target note
      const targetNote = await prisma.note.create({
        data: {
          userId: target.userId,
          title: 'Target Personal Reflection',
          content: 'Target thoughts',
          type: 'STANDALONE',
        },
      });

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: target.userId,
      });

      const csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: target.userId }),
      });

      const notesRes = await fetch(`${baseUrl}/api/notes`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(notesRes.status, 200);
      const notesData = await notesRes.json();
      assert.equal(notesData.notes.length, 1);
      assert.equal(notesData.notes[0].id, targetNote.id);
      assert.equal(notesData.notes[0].title, 'Target Personal Reflection');
    });

    test('16. Account data does not leak between Owner and User across exit', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const target = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);

      // Seed books
      const ownerBook = await prisma.book.create({
        data: { userId: owner.userId, title: 'Owner Book Alpha' },
      });
      const targetBook = await prisma.book.create({
        data: { userId: target.userId, title: 'Target Book Beta' },
      });

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: target.userId,
      });

      let csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: target.userId }),
      });

      // While in owner access: only target's book is visible
      const resInAccess = await fetch(`${baseUrl}/api/books`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      const dataInAccess = await resInAccess.json();
      assert.equal(dataInAccess.books.length, 1);
      assert.equal(dataInAccess.books[0].id, targetBook.id);

      // Exit owner access
      csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/exit`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
      });

      // After exit: only owner's book is visible
      const resPostExit = await fetch(`${baseUrl}/api/books`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      const dataPostExit = await resPostExit.json();
      assert.equal(dataPostExit.books.length, 1);
      assert.equal(dataPostExit.books[0].id, ownerBook.id);
    });

    test('17. Audit events are recorded correctly with timestamps and reasons', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const target = await createAuthenticatedUser('Target', `target_${Date.now()}@example.com`);

      await AccountRelationshipService.linkUser({
        ownerId: owner.userId,
        targetUserId: target.userId,
      });

      let csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ targetUserId: target.userId }),
      });

      csrf = await getCsrf(owner.authCookie);
      await fetch(`${baseUrl}/api/account/owner-access/exit`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}`,
          'X-CSRF-Token': csrf,
        },
      });

      // Fetch history
      const histRes = await fetch(`${baseUrl}/api/account/owner-access/history`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${owner.authCookie}` },
      });
      assert.equal(histRes.status, 200);
      const histData = await histRes.json();
      assert.ok(histData.history.length >= 1);
      const entry = histData.history[0];
      assert.equal(entry.targetUser.id, target.userId);
      assert.equal(entry.status, 'EXITED');
      assert.equal(entry.revocationReason, 'USER_EXIT');
      assert.ok(entry.startedAt);
      assert.ok(entry.endedAt);
    });

    test('18. Normal authentication and normal account usage remain unaffected', async () => {
      const owner = await createAuthenticatedUser('Owner', `owner_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      const user = await createAuthenticatedUser('Normal Reader', `reader_${Date.now()}@example.com`);

      // User creates a book normally
      const csrf = await getCsrf(user.authCookie);
      const createRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.authCookie}`,
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ title: 'My Independent Book' }),
      });
      assert.equal(createRes.status, 201);
      const createData = await createRes.json();
      assert.equal(createData.book.title, 'My Independent Book');
      assert.equal(createData.book.userId, user.userId);
    });
  });
});
