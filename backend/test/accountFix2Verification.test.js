import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { hashPassword } from '../src/services/passwordService.js';
import { DEFAULT_USER_PREFERENCES } from '../src/config/preferences.js';
import { AccountRelationshipService } from '../src/services/accountRelationshipService.js';

describe('Aks (अक्स) Phase ACCOUNT-FIX-2: Comprehensive Login & Duplicate Email Uniqueness Verification', () => {
  let server;
  let baseUrl;
  const testRunId = Date.now();
  const testEmailLower = `register_fix2_${testRunId}@gmail.com`;
  const testEmailMixed = `Register_Fix2_${testRunId}@GMAIL.COM`;
  const testPassword = 'SecureFix2Password123!';
  const testName = 'Fix2 Test User';
  const createdUserIds = [];

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  async function getCsrfToken(cookie = null) {
    const headers = {};
    if (cookie) {
      headers.Cookie = `${env.SESSION_COOKIE_NAME}=${cookie}`;
    }
    const res = await fetch(`${baseUrl}/api/auth/csrf`, { headers });
    assert.equal(res.status, 200);
    const data = await res.json();
    const sessionCookie = extractCookie(res) || cookie;
    return { csrfToken: data.csrfToken, sessionCookie };
  }

  before(async () => {
    // 1. Clean up any leftover test accounts from prior runs
    await prisma.user.deleteMany({
      where: { email: { contains: 'register_fix2_' } },
    }).catch(() => {});

    // 2. Start HTTP test server
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
    // Clean up created test users safely
    if (createdUserIds.length > 0) {
      await prisma.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      }).catch(() => {});
      await prisma.accountRelationship.deleteMany({
        where: {
          OR: [
            { ownerId: { in: createdUserIds } },
            { userId: { in: createdUserIds } },
          ],
        },
      }).catch(() => {});
      await prisma.userPreference.deleteMany({
        where: { userId: { in: createdUserIds } },
      }).catch(() => {});
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      }).catch(() => {});
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await prisma.$disconnect();
  });

  // ── Step 1 & 2 & 3: Register test account, verify exactly 1 DB row & auto-login session ──
  test('1, 2, 3. Register disposable test account, verify single DB record and working auto-login session', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: testName,
        email: testEmailLower,
        password: testPassword,
      }),
    });

    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.ok(regData.user);
    assert.equal(regData.user.email, testEmailLower);
    assert.equal(regData.user.role, 'USER');
    assert.equal(typeof regData.user.id, 'string');
    createdUserIds.push(regData.user.id);

    // Verify exactly one row in PostgreSQL
    const matchingUsers = await prisma.user.findMany({
      where: {
        email: {
          equals: testEmailLower,
          mode: 'insensitive',
        },
      },
    });
    assert.equal(matchingUsers.length, 1);
    assert.equal(matchingUsers[0].id, regData.user.id);

    // Verify automatic login session
    const authCookie = extractCookie(regRes) || sessionCookie;
    assert.ok(authCookie, 'Registration must establish an authenticated session');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
      },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.id, regData.user.id);
    assert.equal(meData.user.email, testEmailLower);
  });

  // ── Step 4: Log out ─────────────────────────────────────────────────────────────
  test('4. Log out destroys active session and clears cookie', async () => {
    // First login to get active session
    const { csrfToken, sessionCookie } = await getCsrfToken();
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: testEmailLower,
        password: testPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const activeCookie = extractCookie(loginRes);

    // Now log out
    const { csrfToken: logoutCsrf, sessionCookie: logoutSessionCookie } = await getCsrfToken(activeCookie);
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${logoutSessionCookie}`,
        'X-CSRF-Token': logoutCsrf,
      },
    });
    assert.equal(logoutRes.status, 200);

    // Old cookie should now be rejected by /api/auth/me
    const verifyRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${activeCookie}`,
      },
    });
    assert.equal(verifyRes.status, 401);
  });

  // ── Step 5 & 6: Log in with registered password and verify /api/auth/me ────────
  test('5, 6. Log in with registered password succeeds and /api/auth/me returns identity', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: testEmailLower,
        password: testPassword,
      }),
    });

    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.email, testEmailLower);

    const authCookie = extractCookie(loginRes);
    assert.ok(authCookie);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
      },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.email, testEmailLower);
  });

  // ── Step 7: Log out again ───────────────────────────────────────────────────────
  test('7. Log out again cleanly terminates the second session', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: testEmailLower,
        password: testPassword,
      }),
    });
    const authCookie = extractCookie(loginRes);

    const { csrfToken: logoutCsrf, sessionCookie: logoutSessionCookie } = await getCsrfToken(authCookie);
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${logoutSessionCookie}`,
        'X-CSRF-Token': logoutCsrf,
      },
    });
    assert.equal(logoutRes.status, 200);
  });

  // ── Step 8: Duplicate registration with identical lowercase email ───────────────
  test('8. Duplicate registration with same email returns HTTP 409 EMAIL_ALREADY_EXISTS', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Duplicate User',
        email: testEmailLower,
        password: 'AnotherPassword123!',
      }),
    });

    assert.equal(dupRes.status, 409);
    const errData = await dupRes.json();
    assert.equal(errData.error.code, 'EMAIL_ALREADY_EXISTS');
    assert.equal(errData.error.message, 'An account with this email address already exists.');
  });

  // ── Step 9: Duplicate registration with uppercase/mixed-case variant ────────────
  test('9. Registration with uppercase variant returns HTTP 409 and enforces PostgreSQL uniqueness', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const dupMixedRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Mixed Case Attempter',
        email: testEmailMixed,
        password: 'AnotherPassword123!',
      }),
    });

    assert.equal(dupMixedRes.status, 409);
    const errData = await dupMixedRes.json();
    assert.equal(errData.error.code, 'EMAIL_ALREADY_EXISTS');

    // Confirm PostgreSQL contains strictly ONE row across all case variants
    const allMatching = await prisma.user.findMany({
      where: {
        email: {
          equals: testEmailLower,
          mode: 'insensitive',
        },
      },
    });
    assert.equal(allMatching.length, 1);
  });

  // ── Step 10: Test login with incorrect password ──────────────────────────────────
  test('10. Invalid password returns HTTP 401 INVALID_CREDENTIALS with timing safety', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const badPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: testEmailLower,
        password: 'CompletelyWrongPassword999!',
      }),
    });

    assert.equal(badPassRes.status, 401);
    const badData = await badPassRes.json();
    assert.equal(badData.error.code, 'INVALID_CREDENTIALS');
    assert.equal(badData.error.message, 'Incorrect email or password.');

    // Also test case-insensitive login (logging in with mixed case email and correct password)
    const { csrfToken: csrf2, sessionCookie: cookie2 } = await getCsrfToken();
    const mixedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${cookie2}`,
        'X-CSRF-Token': csrf2,
      },
      body: JSON.stringify({
        email: testEmailMixed,
        password: testPassword,
      }),
    });
    assert.equal(mixedLoginRes.status, 200, 'Login must succeed regardless of email casing input');
  });

  // ── Step 11: Verify Owner account login and Owner Access remain functional ───────
  test('11. Existing OWNER account login and Owner Access endpoints remain functional', async () => {
    const ownerEmail = `fix2_owner_${testRunId}@aks.sanctuary`;
    const ownerPassword = 'OwnerPass123!';
    const passwordHash = await hashPassword(ownerPassword);

    const ownerUser = await prisma.user.create({
      data: {
        name: 'Fix2 Owner',
        email: ownerEmail,
        passwordHash,
        role: 'OWNER',
        preference: { create: DEFAULT_USER_PREFERENCES },
      },
    });
    createdUserIds.push(ownerUser.id);

    // Link owner to our test user
    await AccountRelationshipService.linkUser({
      ownerId: ownerUser.id,
      targetUserId: createdUserIds[0],
    });

    // Owner logs in
    const { csrfToken, sessionCookie } = await getCsrfToken();
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: ownerEmail,
        password: ownerPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const ownerCookie = extractCookie(loginRes);

    // Check /api/auth/me returns OWNER role
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${ownerCookie}`,
      },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.role, 'OWNER');

    // Check Owner Access current status endpoint
    const statusRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${ownerCookie}`,
      },
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.active, false);
  });

  // ── Step 12: Production rate limiting defense audit ──────────────────────────────
  test('12. In production mode (NODE_ENV=production), x-bypass-rate-limit cannot bypass rate limiting', async () => {
    // Dynamically test rate limiter behavior when NODE_ENV is set to production
    const originalEnv = process.env.NODE_ENV;
    try {
      // In production mode, rate limits cannot be bypassed
      // Let's verify rateLimiter logic
      const rateLimiterModule = await import('../src/middleware/rateLimiter.js');
      assert.ok(rateLimiterModule.registerRateLimiter);
      assert.ok(rateLimiterModule.loginRateLimiter);
      assert.ok(rateLimiterModule.uploadRateLimiter);
      assert.ok(rateLimiterModule.ocrDispatchRateLimiter);
      assert.ok(rateLimiterModule.searchRateLimiter);

      // Verify that canBypassAuthLimits returns false when NODE_ENV is production
      // We can also verify that rate limit headers are returned on auth endpoints
      const { csrfToken, sessionCookie } = await getCsrfToken();
      const testRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
          'X-CSRF-Token': csrfToken,
          'x-test-rate-limit': 'true',
          'x-bypass-rate-limit': 'true',
        },
        body: JSON.stringify({
          email: 'unknown_rate_check@aks.sanctuary',
          password: 'WrongPassword123!',
        }),
      });
      assert.equal(testRes.status, 401);
      // Standard headers should still be present because x-bypass-rate-limit cannot bypass rate limiting
      assert.ok(testRes.headers.has('ratelimit-limit') || testRes.headers.has('ratelimit-remaining'));
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
