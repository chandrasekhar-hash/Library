import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths, initStorage } from '../src/config/storage.js';
import { deleteStoredFile } from '../src/services/storageService.js';

describe('Aks (अक्स) Phase 5: Preferences, Backgrounds & Study Statistics Test Suite', () => {
  let server;
  let baseUrl;

  const testUserIds = [];
  const testBookIds = [];
  const testAssetIds = [];
  let suiteUserA;
  let suiteUserB;

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  const JPEG_BUFFER = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xff, 0xd9,
  ]);

  const PNG_BUFFER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const WEBP_BUFFER = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d,
    0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  const MP4_BUFFER = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);

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

    suiteUserA = await createAuthenticatedUser('User A', 'phase5_user_a');
    suiteUserB = await createAuthenticatedUser('User B', 'phase5_user_b');
  });

  after(async () => {
    if (testBookIds.length > 0) {
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }

    // Clean up test assets in private storage
    for (const uId of testUserIds) {
      const uDir = path.join(storagePaths.backgrounds, uId);
      if (fs.existsSync(uDir)) {
        try {
          fs.rmSync(uDir, { recursive: true, force: true });
        } catch {}
      }
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // ── 1. Global User Preferences ────────────────────────────────────────────
  describe('1. Global User Preferences (/api/preferences)', () => {
    test('1. Default preferences returned for new user without DB insertion', async () => {
      // Ensure no DB preference record exists initially to test fallback to defaults
      await prisma.userPreference.deleteMany({ where: { userId: suiteUserA.userId } });

      const res = await fetch(`${baseUrl}/api/preferences`, {
        headers: suiteUserA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.preferences);
      assert.equal(json.preferences.id, null);
      assert.equal(json.preferences.readingConfig.defaultMode, 'book');
      assert.equal(json.preferences.typographyConfig.fontSize, 18);
      assert.equal(json.preferences.atmosphereConfig.backgroundMode, 'classic');
      assert.equal(json.preferences.studyTimeResetAt, null);

      // Verify no DB record was created by GET
      const dbRecord = await prisma.userPreference.findUnique({
        where: { userId: suiteUserA.userId },
      });
      assert.equal(dbRecord, null);
    });

    test('2. Updating one preference category preserves others', async () => {
      const patchRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          typographyConfig: {
            fontSize: 22,
            fontFamily: 'sans',
          },
        }),
      });

      assert.equal(patchRes.status, 200);
      const patchJson = await patchRes.json();
      assert.equal(patchJson.preferences.typographyConfig.fontSize, 22);
      assert.equal(patchJson.preferences.typographyConfig.fontFamily, 'sans');
      // Unsupplied category remains intact
      assert.equal(patchJson.preferences.readingConfig.defaultMode, 'book');
      assert.equal(patchJson.preferences.atmosphereConfig.backgroundMode, 'classic');

      // Verify DB record now exists
      const dbPref = await prisma.userPreference.findUnique({
        where: { userId: suiteUserA.userId },
      });
      assert.ok(dbPref);
      assert.equal(dbPref.typographyConfig.fontSize, 22);
    });

    test('3. User B cannot view or modify User A preferences (Isolation)', async () => {
      const getB = await fetch(`${baseUrl}/api/preferences`, {
        headers: suiteUserB.headers,
      });
      const jsonB = await getB.json();
      // User B should have default 18, not User A's updated 22
      assert.equal(jsonB.preferences.typographyConfig.fontSize, 18);
    });

    test('4. Invalid preference values are rejected with 400 Bad Request', async () => {
      const res1 = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          typographyConfig: { fontSize: 99 }, // Max is 28
        }),
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          atmosphereConfig: { backgroundMode: 'neon-cyber-invalid' },
        }),
      });
      assert.equal(res2.status, 400);
    });
  });

  // ── 2. Per-Book Preferences ───────────────────────────────────────────────
  describe('2. Per-Book Preferences (/api/books/:bookId/preferences)', () => {
    let bookA;

    before(async () => {
      const book = await prisma.book.create({
        data: {
          userId: suiteUserA.userId,
          title: 'Per-Book Prefs Test Volume',
          totalPages: 150,
        },
      });
      bookA = book;
      testBookIds.push(book.id);
    });

    test('5. Owner accesses book preferences and receives effective resolution', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/preferences`, {
        headers: suiteUserA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.bookId, bookA.id);
      assert.deepEqual(json.config, {});
      // Effective inherits global (fontSize 22 from test 2)
      assert.equal(json.effective.typography.fontSize, 22);
    });

    test('6. User B cannot access or update User A book preferences', async () => {
      const getRes = await fetch(`${baseUrl}/api/books/${bookA.id}/preferences`, {
        headers: suiteUserB.headers,
      });
      assert.equal(getRes.status, 404);

      const patchRes = await fetch(`${baseUrl}/api/books/${bookA.id}/preferences`, {
        method: 'PATCH',
        headers: suiteUserB.headers,
        body: JSON.stringify({ config: { typography: { fontSize: 24 } } }),
      });
      assert.equal(patchRes.status, 404);
    });

    test('7. Per-book overrides override global settings only for that book', async () => {
      const patchRes = await fetch(`${baseUrl}/api/books/${bookA.id}/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          typographyConfig: { fontSize: 26 },
          atmosphereConfig: { backgroundMode: 'pure-black' },
        }),
      });

      assert.equal(patchRes.status, 200);
      const json = await patchRes.json();
      assert.equal(json.effective.typography.fontSize, 26);
      assert.equal(json.effective.atmosphere.backgroundMode, 'pure-black');

      // Global preferences remain unaffected
      const globalRes = await fetch(`${baseUrl}/api/preferences`, {
        headers: suiteUserA.headers,
      });
      const globalJson = await globalRes.json();
      assert.equal(globalJson.preferences.typographyConfig.fontSize, 22);
      assert.equal(globalJson.preferences.atmosphereConfig.backgroundMode, 'classic');
    });

    test('8. Partial updates to book preferences preserve other overrides', async () => {
      const patchRes = await fetch(`${baseUrl}/api/books/${bookA.id}/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          readingConfig: { defaultMode: 'pdf' },
        }),
      });

      assert.equal(patchRes.status, 200);
      const json = await patchRes.json();
      assert.equal(json.effective.reading.defaultMode, 'pdf');
      // Previous typography override (26) preserved
      assert.equal(json.effective.typography.fontSize, 26);
    });
  });

  // ── 3. Background Assets & Private File Management ─────────────────────────
  describe('3. Background Assets & Private Storage (/api/assets)', () => {
    let uploadedAssetId;

    test('9. User A uploads valid JPEG image background', async () => {
      const form = new FormData();
      form.append('file', new Blob([JPEG_BUFFER], { type: 'image/jpeg' }), 'sanctuary_zen.jpg');

      const res = await fetch(`${baseUrl}/api/assets/backgrounds`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${suiteUserA.cookie}`,
          'X-CSRF-Token': suiteUserA.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.asset);
      assert.equal(json.asset.userId, suiteUserA.userId);
      assert.equal(json.asset.assetType, 'BACKGROUND_IMAGE');
      assert.equal(json.asset.mimeType, 'image/jpeg');
      assert.equal(typeof json.asset.sizeBytes, 'number');
      assert.equal(json.asset.storagePath, undefined, 'Internal storage path must not be leaked');

      uploadedAssetId = json.asset.id;
      testAssetIds.push(uploadedAssetId);

      // Verify physical file was created in private storage
      const dbAsset = await prisma.userAsset.findUnique({ where: { id: uploadedAssetId } });
      const physicalPath = path.resolve(storagePaths.root, dbAsset.storagePath);
      assert.ok(fs.existsSync(physicalPath));
    });

    test('10. User A uploads valid MP4 video background', async () => {
      const form = new FormData();
      form.append('file', new Blob([MP4_BUFFER], { type: 'video/mp4' }), 'gentle_rain.mp4');

      const res = await fetch(`${baseUrl}/api/assets/backgrounds`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${suiteUserA.cookie}`,
          'X-CSRF-Token': suiteUserA.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.asset.assetType, 'BACKGROUND_VIDEO');
      assert.equal(json.asset.mimeType, 'video/mp4');
      testAssetIds.push(json.asset.id);
    });

    test('11. Unsupported text file is rejected with 400 Bad Request', async () => {
      const form = new FormData();
      form.append('file', new Blob(['Not an image or video at all'], { type: 'text/plain' }), 'notes.txt');

      const res = await fetch(`${baseUrl}/api/assets/backgrounds`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${suiteUserA.cookie}`,
          'X-CSRF-Token': suiteUserA.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'UNSUPPORTED_ASSET_TYPE');
    });

    test('12. Fake extension file with incorrect magic bytes is rejected', async () => {
      const form = new FormData();
      // Text disguised as .jpg
      form.append('file', new Blob(['fake image data disguised as jpeg'], { type: 'image/jpeg' }), 'fake.jpg');

      const res = await fetch(`${baseUrl}/api/assets/backgrounds`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${suiteUserA.cookie}`,
          'X-CSRF-Token': suiteUserA.csrfToken,
        },
        body: form,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'UNSUPPORTED_ASSET_TYPE');
    });

    test('13. User A can retrieve metadata and stream private asset; User B is denied', async () => {
      // User A retrieves metadata
      const resMeta = await fetch(`${baseUrl}/api/assets/${uploadedAssetId}`, {
        headers: suiteUserA.headers,
      });
      assert.equal(resMeta.status, 200);

      // User A streams asset (HTTP Range request)
      const resStream = await fetch(`${baseUrl}/api/assets/${uploadedAssetId}/file`, {
        headers: {
          ...suiteUserA.headers,
          Range: 'bytes=0-10',
        },
      });
      assert.equal(resStream.status, 206);
      assert.equal(resStream.headers.get('content-type'), 'image/jpeg');

      // User B denied
      const resB = await fetch(`${baseUrl}/api/assets/${uploadedAssetId}`, {
        headers: suiteUserB.headers,
      });
      assert.equal(resB.status, 404);

      const resStreamB = await fetch(`${baseUrl}/api/assets/${uploadedAssetId}/file`, {
        headers: suiteUserB.headers,
      });
      assert.equal(resStreamB.status, 404);
    });

    test('14. Cannot delete an asset that is currently set as active background', async () => {
      // Set uploadedAssetId as current background in global preferences
      await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          atmosphereConfig: {
            backgroundMode: 'custom',
            customMediaId: uploadedAssetId,
          },
        }),
      });

      // Attempt to delete asset -> 409 Conflict
      const delRes = await fetch(`${baseUrl}/api/assets/${uploadedAssetId}`, {
        method: 'DELETE',
        headers: suiteUserA.headers,
      });
      assert.equal(delRes.status, 409);
      const delJson = await delRes.json();
      assert.equal(delJson.error.code, 'ASSET_IN_USE');
    });

    test('15. Safe deletion removes DB record and physical file when not in use', async () => {
      // Reset background preference away from asset
      await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          atmosphereConfig: {
            backgroundMode: 'classic',
            customMediaId: null,
          },
        }),
      });

      const dbAsset = await prisma.userAsset.findUnique({ where: { id: uploadedAssetId } });
      const physicalPath = path.resolve(storagePaths.root, dbAsset.storagePath);
      assert.ok(fs.existsSync(physicalPath));

      // Now delete asset -> 200 OK
      const delRes = await fetch(`${baseUrl}/api/assets/${uploadedAssetId}`, {
        method: 'DELETE',
        headers: suiteUserA.headers,
      });
      assert.equal(delRes.status, 200);

      // Verify DB record and physical file removed
      const dbCheck = await prisma.userAsset.findUnique({ where: { id: uploadedAssetId } });
      assert.equal(dbCheck, null);
      assert.equal(fs.existsSync(physicalPath), false, 'Physical asset file must be deleted from disk');
    });
  });

  // ── 4. Reading Sessions & Study Statistics ────────────────────────────────
  describe('4. Reading Sessions & Statistics (/api/statistics & /api/books/:bookId/sessions)', () => {
    let bookA;

    before(async () => {
      const book = await prisma.book.create({
        data: {
          userId: suiteUserA.userId,
          title: 'Study Session Benchmark Volume',
          totalPages: 200,
        },
      });
      bookA = book;
      testBookIds.push(book.id);
    });

    test('16. User A creates valid reading session', async () => {
      const startedAt = new Date(Date.now() - 1800 * 1000).toISOString();
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/sessions`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          durationSeconds: 1800, // 30 minutes
          startedAt,
        }),
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.ok(json.session);
      assert.equal(json.session.durationSeconds, 1800);
      assert.equal(json.session.bookId, bookA.id);
    });

    test('17. Invalid duration (< 1 or > 86400) is rejected with 400', async () => {
      const res1 = await fetch(`${baseUrl}/api/books/${bookA.id}/sessions`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ durationSeconds: 0 }),
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/books/${bookA.id}/sessions`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ durationSeconds: 999999 }),
      });
      assert.equal(res2.status, 400);
    });

    test('18. Duplicate session submission returns existing record without double-counting', async () => {
      const fixedTime = new Date(Date.now() - 1200 * 1000).toISOString();
      const fixedEndTime = new Date(Date.now() - 600 * 1000).toISOString();

      const res1 = await fetch(`${baseUrl}/api/books/${bookA.id}/sessions`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ durationSeconds: 600, startedAt: fixedTime, endedAt: fixedEndTime }),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      // Send identical request immediately
      const res2 = await fetch(`${baseUrl}/api/books/${bookA.id}/sessions`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ durationSeconds: 600, startedAt: fixedTime, endedAt: fixedEndTime }),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.session.id, json1.session.id, 'Must return same session without creating duplicate');
    });

    test('19. User B cannot submit a session for User A book', async () => {
      const res = await fetch(`${baseUrl}/api/books/${bookA.id}/sessions`, {
        method: 'POST',
        headers: suiteUserB.headers,
        body: JSON.stringify({ durationSeconds: 900 }),
      });
      assert.equal(res.status, 404);
    });

    test('20. Statistics endpoint calculates active and all-time study metrics correctly', async () => {
      const res = await fetch(`${baseUrl}/api/statistics`, {
        headers: suiteUserA.headers,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.statistics);
      assert.ok(json.statistics.totalStudyTimeSeconds >= 2400); // 1800 + 600
      assert.ok(json.statistics.allTimeStudyTimeSeconds >= 2400);
      assert.ok(json.statistics.totalSessionsCount >= 2);
      assert.ok(Array.isArray(json.statistics.dailyStudyTime));
    });

    test('21. Reset study statistics advances studyTimeResetAt without deleting historical sessions', async () => {
      // 1. Check sessions count before reset
      const countBefore = await prisma.readingSession.count({ where: { userId: suiteUserA.userId } });
      assert.ok(countBefore >= 2);

      // 2. Perform reset
      const resetRes = await fetch(`${baseUrl}/api/statistics/reset`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      assert.equal(resetRes.status, 200);

      // 3. Verify historical sessions in database were NOT deleted
      const countAfter = await prisma.readingSession.count({ where: { userId: suiteUserA.userId } });
      assert.equal(countAfter, countBefore, 'Reset must not delete historical ReadingSession rows');

      // 4. Verify active study time is now 0 while all-time reflects historical total
      const statsRes = await fetch(`${baseUrl}/api/statistics`, {
        headers: suiteUserA.headers,
      });
      const statsJson = await statsRes.json();
      assert.equal(statsJson.statistics.totalStudyTimeSeconds, 0, 'Active study time should reset to 0');
      assert.equal(statsJson.statistics.totalSessionsCount, 0);
      assert.ok(statsJson.statistics.allTimeStudyTimeSeconds >= 2400, 'All-time study time must remain preserved');
      assert.ok(statsJson.statistics.lastResetAt);
    });

    test('22. New session after reset counts towards active study time while preserving historical', async () => {
      const pref = await prisma.userPreference.findUnique({ where: { userId: suiteUserA.userId } });
      const resetTime = pref.studyTimeResetAt;

      // Create session strictly starting after the reset timestamp
      const sStart = new Date(resetTime.getTime() + 1000);
      const sEnd = new Date(resetTime.getTime() + 1201 * 1000);

      const session = await prisma.readingSession.create({
        data: {
          userId: suiteUserA.userId,
          bookId: bookA.id,
          durationSeconds: 1200,
          startedAt: sStart,
          endedAt: sEnd,
        },
      });

      const statsRes = await fetch(`${baseUrl}/api/statistics`, {
        headers: suiteUserA.headers,
      });
      const statsJson = await statsRes.json();
      assert.equal(statsJson.statistics.totalStudyTimeSeconds, 1200, 'Only post-reset session counts for active time');
      assert.equal(statsJson.statistics.totalSessionsCount, 1);
      assert.ok(statsJson.statistics.allTimeStudyTimeSeconds >= 3600); // 2400 + 1200

      // Clean up test 22 session so its future endedAt does not affect subsequent tests
      await prisma.readingSession.delete({ where: { id: session.id } });
    });



  });

  // ── 5. Targeted Hardening & Regression Verification ───────────────────────
  describe('5. Targeted Hardening & Regression Verification', () => {
    let hardenBook;
    let markerAssetId;

    before(async () => {
      const book = await prisma.book.create({
        data: {
          userId: suiteUserA.userId,
          title: 'Hardening Test Volume',
          totalPages: 300,
        },
      });
      hardenBook = book;
      testBookIds.push(book.id);

      // Upload an asset to test marker reference checks
      const form = new FormData();
      form.append('file', new Blob([JPEG_BUFFER], { type: 'image/jpeg' }), 'marker.jpg');
      const res = await fetch(`${baseUrl}/api/assets/backgrounds`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${suiteUserA.cookie}`,
          'X-CSRF-Token': suiteUserA.csrfToken,
        },
        body: form,
      });
      const json = await res.json();
      markerAssetId = json.asset.id;
      testAssetIds.push(markerAssetId);
    });

    test('23. Server-authoritative start/finish lifecycle calculates duration on server', async () => {
      // 1. Start session
      const startRes = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({}),
      });
      assert.equal(startRes.status, 201);
      const startJson = await startRes.json();
      assert.ok(startJson.session);
      assert.equal(startJson.session.isActive, true);
      assert.equal(startJson.session.durationSeconds, 0);
      assert.ok(startJson.session.startedAt);

      const sessionId = startJson.session.id;

      // Sleep 50ms to have positive elapsed time
      await new Promise((r) => setTimeout(r, 60));

      // 2. Finish session without passing duration (client cannot tamper)
      const finishRes = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${sessionId}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ durationSeconds: 99999 }), // Should be ignored by server
      });
      assert.equal(finishRes.status, 200);
      const finishJson = await finishRes.json();
      assert.equal(finishJson.session.isActive, false);
      assert.ok(finishJson.session.endedAt);
      // Duration is server-calculated (1s minimum), NOT the client's 99999
      assert.ok(finishJson.session.durationSeconds >= 1 && finishJson.session.durationSeconds <= 5);
    });

    test('24. Stable clientSessionId guarantees idempotency on start and finish', async () => {
      const stableId = crypto.randomUUID();

      // Start attempt 1
      const res1 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ clientSessionId: stableId }),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      assert.equal(json1.session.id, stableId);

      // Start attempt 2 (retry with same stableId) -> Returns 200 with existing session
      const res2 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ clientSessionId: stableId }),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.session.id, stableId);

      // Finish attempt 1
      const fin1 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${stableId}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      assert.equal(fin1.status, 200);

      // Finish attempt 2 (idempotent retry) -> Returns 200 with same finished session
      const fin2 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${stableId}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      assert.equal(fin2.status, 200);
      const fin2Json = await fin2.json();
      assert.equal(fin2Json.session.id, stableId);
      assert.equal(fin2Json.session.isActive, false);
    });

    test('25. Starting a second session auto-closes active session to prevent double-counting', async () => {
      // Start session A
      const resA = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      const jsonA = await resA.json();
      const sessionAId = jsonA.session.id;

      // Start session B without explicitly finishing A
      const resB = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      const jsonB = await resB.json();
      const sessionBId = jsonB.session.id;

      // Verify session A was automatically closed by server
      const dbSessionA = await prisma.readingSession.findUnique({ where: { id: sessionAId } });
      assert.ok(dbSessionA.endedAt !== null, 'Previous session must be closed');
      assert.ok(dbSessionA.durationSeconds >= 1);

      // Session B is the currently active session
      const dbSessionB = await prisma.readingSession.findUnique({ where: { id: sessionBId } });
      assert.equal(dbSessionB.endedAt, null, 'New session remains active');

      // Finish B to clean up
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${sessionBId}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
    });

    test('26. Session spanning reset boundary counts ONLY the post-reset portion', async () => {
      // Ensure reset timestamp is strictly after all prior sessions
      await new Promise((r) => setTimeout(r, 30));

      // 1. Reset study statistics at a known time
      await fetch(`${baseUrl}/api/statistics/reset`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });

      const pref = await prisma.userPreference.findUnique({ where: { userId: suiteUserA.userId } });
      const resetTime = pref.studyTimeResetAt;


      // 2. Create a synthetic session that started 10 minutes BEFORE reset and ended 10 minutes AFTER reset (total 20 min = 1200s)
      const spanningStarted = new Date(resetTime.getTime() - 600 * 1000);
      const spanningEnded = new Date(resetTime.getTime() + 600 * 1000);
      const spanningSession = await prisma.readingSession.create({
        data: {
          userId: suiteUserA.userId,
          bookId: hardenBook.id,
          startedAt: spanningStarted,
          endedAt: spanningEnded,
          durationSeconds: 1200,
        },
      });

      // 3. Query statistics
      const statsRes = await fetch(`${baseUrl}/api/statistics`, {
        headers: suiteUserA.headers,
      });
      const statsJson = await statsRes.json();

      // Only the 600s occurring AFTER reset must count towards active study time!
      // (10 minutes after reset = 600s)
      assert.equal(statsJson.statistics.totalStudyTimeSeconds, 600, 'Only post-reset 600s must count');
      assert.equal(statsJson.statistics.totalSessionsCount, 1);
      // All-time reflects the full 1200s
      assert.ok(statsJson.statistics.allTimeStudyTimeSeconds >= 1200);

      // Cleanup synthetic session
      await prisma.readingSession.delete({ where: { id: spanningSession.id } });
    });

    test('27. Legacy session submission rejects inconsistent duration and timestamps', async () => {
      const now = new Date();
      const tenAgo = new Date(now.getTime() - 600 * 1000);

      const res = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          durationSeconds: 3600, // Client says 1 hour
          startedAt: tenAgo.toISOString(),
          endedAt: now.toISOString(), // But interval is only 10 minutes!
        }),
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error.code, 'TIMESTAMPS_INCONSISTENT');
    });

    test('28. Global custom marker reference blocks asset deletion (409 ASSET_IN_USE)', async () => {
      // Attach markerAssetId as custom marker in global preferences
      const patchRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          annotationsConfig: {
            customMarkerId: markerAssetId,
            customMarkerUrl: `/api/assets/${markerAssetId}/file`,
          },
        }),
      });
      assert.equal(patchRes.status, 200);

      // Attempt to delete asset -> Must be blocked with 409 ASSET_IN_USE
      const delRes = await fetch(`${baseUrl}/api/assets/${markerAssetId}`, {
        method: 'DELETE',
        headers: suiteUserA.headers,
      });
      assert.equal(delRes.status, 409);
      const delJson = await delRes.json();
      assert.equal(delJson.error.code, 'ASSET_IN_USE');

      // Clear global marker reference
      await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          annotationsConfig: {
            customMarkerId: null,
            customMarkerUrl: null,
          },
        }),
      });
    });

    test('29. Per-book custom marker reference blocks asset deletion (409 ASSET_IN_USE)', async () => {
      // Attach markerAssetId in book preferences
      const patchRes = await fetch(`${baseUrl}/api/books/${hardenBook.id}/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          annotationsConfig: {
            customMarkerId: markerAssetId,
          },
        }),
      });
      assert.equal(patchRes.status, 200);

      // Attempt to delete asset -> Must be blocked with 409 ASSET_IN_USE
      const delRes = await fetch(`${baseUrl}/api/assets/${markerAssetId}`, {
        method: 'DELETE',
        headers: suiteUserA.headers,
      });
      assert.equal(delRes.status, 409);
      const delJson = await delRes.json();
      assert.equal(delJson.error.code, 'ASSET_IN_USE');

      // Clear book preference reference
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          annotationsConfig: {
            customMarkerId: null,
          },
        }),
      });

      // Now unreferenced asset can be deleted safely -> 200 OK
      const finalDel = await fetch(`${baseUrl}/api/assets/${markerAssetId}`, {
        method: 'DELETE',
        headers: suiteUserA.headers,
      });
      assert.equal(finalDel.status, 200);
    });

    test('30. Unknown root and nested preference keys are rejected with 400', async () => {
      // Unknown root key
      const resRoot = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          unknownCategory: { foo: 'bar' },
        }),
      });
      assert.equal(resRoot.status, 400);
      const jsonRoot = await resRoot.json();
      assert.equal(jsonRoot.error.code, 'INVALID_PREFERENCE_KEY');

      // Unknown nested key
      const resNested = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          readingConfig: { unauthorizedSetting: 123 },
        }),
      });
      assert.equal(resNested.status, 400);
      const jsonNested = await resNested.json();
      assert.equal(jsonNested.error.code, 'INVALID_PREFERENCE_KEY');
    });

    test('31. Prototype pollution keys are rejected with 400', async () => {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          __proto__: { admin: true },
        }),
      });
      assert.equal(res.status, 400);
    });

    test('32. Nullable fields can be cleared explicitly with null', async () => {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: suiteUserA.headers,
        body: JSON.stringify({
          atmosphereConfig: {
            customMediaId: null,
          },
        }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.preferences.atmosphereConfig.customMediaId, null);
    });

    test('33. New user registration receives defaults from config/preferences.js', async () => {
      const newUser = await createAuthenticatedUser('Defaults Test', 'user_defaults');
      const res = await fetch(`${baseUrl}/api/preferences`, {
        headers: newUser.headers,
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.preferences.readingConfig.defaultMode, 'book');
      assert.equal(json.preferences.typographyConfig.surfaceTheme, 'navy');
      assert.equal(json.preferences.annotationsConfig.defaultMarker, 'peacock-feather');
      assert.equal(json.preferences.atmosphereConfig.currentMoodId, 'modern-dark');
    });

    test('34. Concurrent start requests serialize per user and leave exactly ONE active session', async () => {
      const key1 = `concurrent-start-1-${crypto.randomUUID()}`;
      const key2 = `concurrent-start-2-${crypto.randomUUID()}`;
      const key3 = `concurrent-start-3-${crypto.randomUUID()}`;

      // Dispatch 3 simultaneous start requests
      const [res1, res2, res3] = await Promise.all([
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
          method: 'POST',
          headers: suiteUserA.headers,
          body: JSON.stringify({ idempotencyKey: key1 }),
        }),
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
          method: 'POST',
          headers: suiteUserA.headers,
          body: JSON.stringify({ idempotencyKey: key2 }),
        }),
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
          method: 'POST',
          headers: suiteUserA.headers,
          body: JSON.stringify({ idempotencyKey: key3 }),
        }),
      ]);

      assert.ok([200, 201].includes(res1.status));
      assert.ok([200, 201].includes(res2.status));
      assert.ok([200, 201].includes(res3.status));

      // Query database for all active sessions for this user
      const activeSessions = await prisma.readingSession.findMany({
        where: { userId: suiteUserA.userId, endedAt: null },
      });

      // EXACTLY one active session must remain!
      assert.equal(activeSessions.length, 1, 'Only one session must remain active after concurrent starts');

      // Finish the remaining active session
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${activeSessions[0].id}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
    });

    test('35. Concurrent finish requests serialize and return consistent duration and endedAt', async () => {
      // Start a session
      const startRes = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      const startJson = await startRes.json();
      const sId = startJson.session.id;

      // Small delay so duration >= 1
      await new Promise((r) => setTimeout(r, 20));

      // Dispatch 3 simultaneous finish requests for the same session
      const [f1, f2, f3] = await Promise.all([
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${sId}/finish`, {
          method: 'POST',
          headers: suiteUserA.headers,
        }),
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${sId}/finish`, {
          method: 'POST',
          headers: suiteUserA.headers,
        }),
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${sId}/finish`, {
          method: 'POST',
          headers: suiteUserA.headers,
        }),
      ]);

      assert.equal(f1.status, 200);
      assert.equal(f2.status, 200);
      assert.equal(f3.status, 200);

      const j1 = await f1.json();
      const j2 = await f2.json();
      const j3 = await f3.json();

      // All responses must agree on session duration and endedAt
      assert.equal(j1.session.durationSeconds, j2.session.durationSeconds);
      assert.equal(j2.session.durationSeconds, j3.session.durationSeconds);
      assert.equal(j1.session.endedAt, j2.session.endedAt);
      assert.equal(j2.session.endedAt, j3.session.endedAt);
      assert.equal(j1.session.isActive, false);
    });

    test('36. Durable idempotencyKey persistence and repeated start with same key', async () => {
      const stableKey = `persist-key-${Date.now()}`;

      // Start attempt 1 -> 201 Created
      const res1 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: stableKey }),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      assert.equal(json1.session.idempotencyKey, stableKey);

      // Verify directly in DB that column idempotencyKey is persisted
      const dbRecord = await prisma.readingSession.findUnique({
        where: { id: json1.session.id },
      });
      assert.equal(dbRecord.idempotencyKey, stableKey);

      // Repeated start with same key -> 200 OK (idempotent retrieve)
      const res2 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: stableKey }),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.session.id, json1.session.id);
      assert.equal(json2.session.idempotencyKey, stableKey);

      // Finish session
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${json1.session.id}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
    });

    test('37. Same idempotencyKey submitted concurrently returns identical session and creates one record', async () => {
      const raceKey = `race-key-${crypto.randomUUID()}`;

      // Send 2 concurrent requests with the identical idempotencyKey
      const [resA, resB] = await Promise.all([
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
          method: 'POST',
          headers: suiteUserA.headers,
          body: JSON.stringify({ idempotencyKey: raceKey }),
        }),
        fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
          method: 'POST',
          headers: suiteUserA.headers,
          body: JSON.stringify({ idempotencyKey: raceKey }),
        }),
      ]);

      assert.ok([200, 201].includes(resA.status));
      assert.ok([200, 201].includes(resB.status));

      const jsonA = await resA.json();
      const jsonB = await resB.json();

      // Both requests must return the exact same session
      assert.equal(jsonA.session.id, jsonB.session.id);
      assert.equal(jsonA.session.idempotencyKey, raceKey);

      // Verify in DB that only one record exists for this key
      const count = await prisma.readingSession.count({
        where: { userId: suiteUserA.userId, idempotencyKey: raceKey },
      });
      assert.equal(count, 1, 'Database unique constraint must ensure exactly one record per (userId, idempotencyKey)');

      // Cleanup
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${jsonA.session.id}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
    });

    test('38. Same idempotencyKey used by two different users succeeds independently (scoped uniqueness)', async () => {
      const crossUserKey = `shared-key-${crypto.randomUUID()}`;

      // User A uses the key
      const resA = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: crossUserKey }),
      });
      assert.equal(resA.status, 201);
      const jsonA = await resA.json();
      assert.equal(jsonA.session.userId, suiteUserA.userId);
      assert.equal(jsonA.session.idempotencyKey, crossUserKey);

      // User B uses the EXACT same key on their own book
      const userBBook = await prisma.book.create({
        data: {
          userId: suiteUserB.userId,
          title: 'User B Cross-Key Book',
          author: 'Aks Author',
          format: 'PDF',
          totalPages: 50,
        },
      });

      const resB = await fetch(`${baseUrl}/api/books/${userBBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserB.headers,
        body: JSON.stringify({ idempotencyKey: crossUserKey }),
      });
      assert.equal(resB.status, 201, 'User B must not collide with User A key');
      const jsonB = await resB.json();
      assert.equal(jsonB.session.userId, suiteUserB.userId);
      assert.equal(jsonB.session.idempotencyKey, crossUserKey);

      // Must be two distinct session IDs
      assert.notEqual(jsonA.session.id, jsonB.session.id);

      // Clean up both
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${jsonA.session.id}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
      await fetch(`${baseUrl}/api/books/${userBBook.id}/sessions/${jsonB.session.id}/finish`, {
        method: 'POST',
        headers: suiteUserB.headers,
      });
      await prisma.book.delete({ where: { id: userBBook.id } });
    });

    test('39. Different keys for sequential sessions close prior and create active', async () => {
      const seqKey1 = `seq-key-1-${crypto.randomUUID()}`;
      const seqKey2 = `seq-key-2-${crypto.randomUUID()}`;

      // Session 1
      const res1 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: seqKey1 }),
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      // Session 2 with different key
      const res2 = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: seqKey2 }),
      });
      assert.equal(res2.status, 201);
      const json2 = await res2.json();

      // Session 1 is auto-closed
      const db1 = await prisma.readingSession.findUnique({ where: { id: json1.session.id } });
      assert.ok(db1.endedAt !== null);

      // Session 2 is active
      const db2 = await prisma.readingSession.findUnique({ where: { id: json2.session.id } });
      assert.equal(db2.endedAt, null);

      // Clean up session 2
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${json2.session.id}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
    });

    test('40. Retry after simulated restart retrieves session from persisted database', async () => {
      const restartKey = `restart-key-${Date.now()}`;

      // Create initial session
      const startRes = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: restartKey }),
      });
      assert.equal(startRes.status, 201);
      const startJson = await startRes.json();
      const sessionId = startJson.session.id;

      // Confirm persisted in PostgreSQL
      const persisted = await prisma.readingSession.findFirst({
        where: { userId: suiteUserA.userId, idempotencyKey: restartKey },
      });
      assert.ok(persisted);
      assert.equal(persisted.id, sessionId);

      // Simulate client retry on "fresh" connection
      const retryRes = await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/start`, {
        method: 'POST',
        headers: suiteUserA.headers,
        body: JSON.stringify({ idempotencyKey: restartKey }),
      });
      assert.equal(retryRes.status, 200);
      const retryJson = await retryRes.json();
      assert.equal(retryJson.session.id, sessionId);
      assert.equal(retryJson.session.idempotencyKey, restartKey);

      // Clean up
      await fetch(`${baseUrl}/api/books/${hardenBook.id}/sessions/${sessionId}/finish`, {
        method: 'POST',
        headers: suiteUserA.headers,
      });
    });
  });
});


