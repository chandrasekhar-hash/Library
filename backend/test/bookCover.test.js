import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths } from '../src/config/storage.js';

describe('Aks (अक्स) Automatic PDF Book Covers & Custom Cover Selection Test Suite', () => {
  let server;
  let baseUrl;

  const testUserIds = [];
  const testBookIds = [];

  // Minimal valid 1x1 JPEG image bytes: FF D8 FF E0 ... FF D9
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9,
  ]);

  // Helper to extract session cookie
  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Helper to create an authenticated user
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

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
        'X-CSRF-Token': regCsrf,
      },
      body: JSON.stringify({ email, password }),
    });
    const authCookie = extractCookie(loginRes);

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

  // Helper to construct multipart payload
  function createMultipartPayload(fields, fileField) {
    const boundary = `----AksTestBoundary${Date.now()}`;
    const chunks = [];

    for (const [key, value] of Object.entries(fields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
        )
      );
    }

    if (fileField) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`
        )
      );
      chunks.push(fileField.buffer);
      chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    return {
      body,
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    // Clean up created books and users
    if (testBookIds.length > 0) {
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }

    // Clean up test covers
    for (const uid of testUserIds) {
      const udir = path.join(storagePaths.covers, uid);
      if (fs.existsSync(udir)) {
        try {
          fs.rmSync(udir, { recursive: true, force: true });
        } catch (_) {}
      }
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  test('1. Unauthenticated requests to book cover endpoints are rejected', async () => {
    const res = await fetch(`${baseUrl}/api/books/00000000-0000-0000-0000-000000000000/cover`);
    assert.equal(res.status, 401);
  });

  test('2. Uploading a default cover saves the image and updates book colorScheme', async () => {
    const user = await createAuthenticatedUser('Cover User 1', `cover1_${Date.now()}@example.com`, 'Password123!');

    // Create a book
    const createRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...user.authHeaders,
      },
      body: JSON.stringify({
        title: 'Book for Cover Test',
        totalPages: 10,
      }),
    });
    assert.equal(createRes.status, 201);
    const { book } = await createRes.json();
    testBookIds.push(book.id);

    // Upload default cover (page 1)
    const { body, contentType } = createMultipartPayload(
      { type: 'default', page: '1' },
      { name: 'file', filename: 'cover_page_1.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );

    const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: {
        ...user.authHeaders,
        'Content-Type': contentType,
      },
      body,
    });

    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.book.colorScheme.defaultCoverPage, 1);
    assert.equal(uploadJson.book.colorScheme.hasCustomCover, false);
    assert.ok(uploadJson.book.colorScheme.coverUpdatedAt > 0);

    // Stream the active cover
    const streamRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      headers: user.authHeaders,
    });
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get('content-type'), 'image/jpeg');
    const streamBytes = Buffer.from(await streamRes.arrayBuffer());
    assert.equal(streamBytes.length, validJpegBuffer.length);
  });

  test('3. Custom Cover Selection: Uploading a custom cover for page 5 sets hasCustomCover and customCoverPage', async () => {
    const user = await createAuthenticatedUser('Cover User 2', `cover2_${Date.now()}@example.com`, 'Password123!');

    const createRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...user.authHeaders,
      },
      body: JSON.stringify({
        title: 'Custom Cover Book',
        totalPages: 20,
      }),
    });
    const { book } = await createRes.json();
    testBookIds.push(book.id);

    // Upload default cover first
    const defPayload = createMultipartPayload(
      { type: 'default', page: '1' },
      { name: 'file', filename: 'page1.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );
    await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': defPayload.contentType },
      body: defPayload.body,
    });

    // Option A: "This is the book cover" (Page 5)
    const customPayload = createMultipartPayload(
      { type: 'custom', page: '5' },
      { name: 'file', filename: 'page5.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );
    const customRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': customPayload.contentType },
      body: customPayload.body,
    });

    assert.equal(customRes.status, 200);
    const customJson = await customRes.json();
    assert.equal(customJson.book.colorScheme.hasCustomCover, true);
    assert.equal(customJson.book.colorScheme.customCoverPage, 5);
    assert.equal(customJson.book.colorScheme.defaultCoverPage, 1);

    // Verify streaming default cover explicitly via ?type=default
    const defStreamRes = await fetch(`${baseUrl}/api/books/${book.id}/cover?type=default`, {
      headers: user.authHeaders,
    });
    assert.equal(defStreamRes.status, 200);

    // Verify streaming active cover returns 200
    const activeStreamRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      headers: user.authHeaders,
    });
    assert.equal(activeStreamRes.status, 200);
  });

  test('4. Reset Action: Resetting custom cover restores default cover', async () => {
    const user = await createAuthenticatedUser('Cover User 3', `cover3_${Date.now()}@example.com`, 'Password123!');

    const createRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...user.authHeaders,
      },
      body: JSON.stringify({
        title: 'Reset Cover Book',
        totalPages: 15,
      }),
    });
    const { book } = await createRes.json();
    testBookIds.push(book.id);

    // 1. Upload default cover (Page 1)
    const defaultPayload = createMultipartPayload(
      { type: 'default', page: '1' },
      { name: 'file', filename: 'page1.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );
    await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': defaultPayload.contentType },
      body: defaultPayload.body,
    });

    // 2. Upload custom cover (Page 8)
    const customPayload = createMultipartPayload(
      { type: 'custom', page: '8' },
      { name: 'file', filename: 'page8.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );
    await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': customPayload.contentType },
      body: customPayload.body,
    });

    // 3. Replace with another custom cover (Page 12)
    const customPayload2 = createMultipartPayload(
      { type: 'custom', page: '12' },
      { name: 'file', filename: 'page12.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );
    await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': customPayload2.contentType },
      body: customPayload2.body,
    });

    // 4. Reset cover to original PDF cover
    const resetRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/reset`, {
      method: 'POST',
      headers: user.authHeaders,
    });
    assert.equal(resetRes.status, 200);
    const resetJson = await resetRes.json();
    assert.equal(resetJson.book.colorScheme.hasCustomCover, false);
    assert.equal(resetJson.book.colorScheme.customCoverPage, null);
    assert.equal(resetJson.book.colorScheme.defaultCoverPage, 1);

    // 5. Streaming active cover returns default cover (status 200)
    const streamRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      headers: user.authHeaders,
    });
    assert.equal(streamRes.status, 200);

    // 6. Repeated reset click is safe and idempotent
    const repeatResetRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/reset`, {
      method: 'POST',
      headers: user.authHeaders,
    });
    assert.equal(repeatResetRes.status, 200);
  });

  test('5. Multi-tenant Account Isolation: User B cannot view or modify User A cover', async () => {
    const userA = await createAuthenticatedUser('User A', `usera_${Date.now()}@example.com`, 'Password123!');
    const userB = await createAuthenticatedUser('User B', `userb_${Date.now()}@example.com`, 'Password123!');

    const createRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userA.authHeaders,
      },
      body: JSON.stringify({
        title: 'User A Secret Book',
        totalPages: 5,
      }),
    });
    const { book } = await createRes.json();
    testBookIds.push(book.id);

    // User A uploads cover
    const payload = createMultipartPayload(
      { type: 'default', page: '1' },
      { name: 'file', filename: 'page1.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );
    await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...userA.authHeaders, 'Content-Type': payload.contentType },
      body: payload.body,
    });

    // User B attempts to stream User A's cover -> 404
    const getRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      headers: userB.authHeaders,
    });
    assert.equal(getRes.status, 404);

    // User B attempts to reset User A's cover -> 404
    const resetRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/reset`, {
      method: 'POST',
      headers: userB.authHeaders,
    });
    assert.equal(resetRes.status, 404);

    // User B attempts to upload a cover to User A's book -> 404
    const hijackRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...userB.authHeaders, 'Content-Type': payload.contentType },
      body: payload.body,
    });
    assert.equal(hijackRes.status, 404);
  });

  test('6. Cover Page Placement Selection & Persistence', async () => {
    const user = await createAuthenticatedUser('Placement User', 'placement@aks.dev', 'SecretPassword123!');
    const createRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Placement Test Volume',
        totalPages: 10,
      }),
    });
    const { book } = await createRes.json();
    testBookIds.push(book.id);

    // 1. Upload custom cover with Left Page placement
    const payload = createMultipartPayload(
      { type: 'custom', page: '3', placement: 'left' },
      { name: 'file', filename: 'cover.jpg', contentType: 'image/jpeg', buffer: validJpegBuffer }
    );

    const uploadRes = await fetch(`${baseUrl}/api/books/${book.id}/cover`, {
      method: 'POST',
      headers: { ...user.authHeaders, 'Content-Type': payload.contentType },
      body: payload.body,
    });
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.book.colorScheme?.coverPlacement, 'left');
    assert.equal(uploadData.book.colorScheme?.hasCustomCover, true);

    // 2. Update placement directly to 'right' via PATCH
    const patchRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/placement`, {
      method: 'PATCH',
      headers: { ...user.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ placement: 'right' }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.equal(patchData.book.colorScheme?.coverPlacement, 'right');

    // 3. Switch placement back to 'left' via PATCH
    const patchBackRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/placement`, {
      method: 'PATCH',
      headers: { ...user.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ placement: 'left' }),
    });
    assert.equal(patchBackRes.status, 200);
    const patchBackData = await patchBackRes.json();
    assert.equal(patchBackData.book.colorScheme?.coverPlacement, 'left');

    // 4. Reject invalid placement
    const invalidRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/placement`, {
      method: 'PATCH',
      headers: { ...user.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ placement: 'center' }),
    });
    assert.equal(invalidRes.status, 400);

    // 5. User isolation: Another user cannot update placement
    const user2 = await createAuthenticatedUser('Other User', 'other@aks.dev', 'SecretPassword123!');
    const isolatedRes = await fetch(`${baseUrl}/api/books/${book.id}/cover/placement`, {
      method: 'PATCH',
      headers: { ...user2.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ placement: 'right' }),
    });
    assert.equal(isolatedRes.status, 404);
  });
});
