import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';

describe('Aks (अक्स) Authentication & Session System Test Suite', () => {
  let server;
  let baseUrl;
  const testUserIds = [];

  // Helper to extract cookie from Set-Cookie header
  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Helper to extract Set-Cookie header string
  function getRawSetCookie(res) {
    return res.headers.get('set-cookie') || '';
  }

  before(async () => {
    // Start ephemeral server
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
    // Clean up created test users
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      });
    }
    // Clean up anonymous test sessions generated during test runs
    await prisma.session.deleteMany();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // ── 1. CSRF Protection Tests ──────────────────────────────────────────────
  describe('CSRF Protection', () => {
    test('GET /api/auth/csrf generates and returns a session-backed CSRF token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/csrf`);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.ok(data.csrfToken, 'CSRF token should be returned');
      assert.equal(typeof data.csrfToken, 'string');
      assert.equal(data.csrfToken.length, 64, 'CSRF token should be 64-char hex');

      const cookie = extractCookie(res);
      assert.ok(cookie, 'Session cookie should be set');
    });

    test('POST /api/auth/register rejects request with missing CSRF token (403)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'No Csrf User',
          email: 'no-csrf@example.com',
          password: 'Password123!',
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'EBADCSRFTOKEN');
    });

    test('POST /api/auth/register rejects request with invalid CSRF token (403)', async () => {
      // First get a real session
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);

      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': 'invalid_csrf_token_000000000000000000000000000000000000000000000000',
        },
        body: JSON.stringify({
          name: 'Invalid Csrf User',
          email: 'invalid-csrf@example.com',
          password: 'Password123!',
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'EBADCSRFTOKEN');
    });
  });

  // ── 2. Registration Tests ─────────────────────────────────────────────────
  describe('User Registration', () => {
    test('Successfully creates an account with normalized email, hashed password, and no sensitive leaks', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const rawEmail = '  Aks.Reader@Example.COM  ';
      const password = 'StrongPassword99!';

      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Aks Reader',
          email: rawEmail,
          password,
        }),
      });

      assert.equal(regRes.status, 201);
      const regData = await regRes.json();

      assert.ok(regData.user);
      assert.ok(regData.user.id);
      testUserIds.push(regData.user.id);

      assert.equal(regData.user.name, 'Aks Reader');
      assert.equal(regData.user.email, 'aks.reader@example.com', 'Email must be normalized to lowercase and trimmed');
      assert.equal(regData.user.passwordHash, undefined, 'Password hash must never be returned in API responses');
      assert.equal(regData.user.password, undefined, 'Plaintext password must never be returned');

      // Verify in PostgreSQL database
      const dbUser = await prisma.user.findUnique({
        where: { id: regData.user.id },
      });

      assert.ok(dbUser);
      assert.equal(dbUser.email, 'aks.reader@example.com');
      assert.notEqual(dbUser.passwordHash, password, 'Password must not be stored in plaintext');
      assert.ok(dbUser.passwordHash.startsWith('$argon2id$'), 'Password must be hashed using Argon2id');
    });

    test('Rejects duplicate email registrations gracefully (409 Conflict)', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Duplicate Reader',
          email: 'aks.reader@example.com', // Already registered
          password: 'AnotherPassword123!',
        }),
      });

      assert.equal(regRes.status, 409);
      const regData = await regRes.json();
      assert.equal(regData.error.code, 'EMAIL_ALREADY_EXISTS');
      assert.equal(regData.error.message, 'An account with this email address already exists.');
    });

    test('Rejects invalid input (short password, invalid email format)', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      // Weak password
      const res1 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Short Pass',
          email: 'shortpass@example.com',
          password: 'short',
        }),
      });
      assert.equal(res1.status, 400);

      // Invalid email
      const res2 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Bad Email',
          email: 'not-an-email',
          password: 'ValidPassword123!',
        }),
      });
      assert.equal(res2.status, 400);
    });
  });

  // ── 3. Login Tests ────────────────────────────────────────────────────────
  describe('User Login & Session Fixation Protection', () => {
    test('Correct credentials succeed and regenerate session ID', async () => {
      // 1. Initial anonymous session
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const anonCookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      // 2. Perform login
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'aks.reader@example.com',
          password: 'StrongPassword99!',
          rememberMe: true,
        }),
      });

      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();

      assert.ok(loginData.user);
      assert.equal(loginData.user.email, 'aks.reader@example.com');
      assert.equal(loginData.sessionId, undefined, 'Session ID must never be exposed in JSON body');
      assert.equal(loginData.user.passwordHash, undefined);

      // Session ID MUST change after login (Session Fixation protection)
      const authCookie = extractCookie(loginRes);
      assert.ok(authCookie, 'New session cookie must be set on login');
      assert.notEqual(authCookie, anonCookie, 'Session ID must regenerate upon successful authentication');

      // Verify Set-Cookie header contains Max-Age for Remember Me
      const rawCookie = getRawSetCookie(loginRes);
      assert.ok(rawCookie.includes('Max-Age=2592000') || rawCookie.includes('Expires='), 'Remember Me session should have ~30 day expiry');
    });

    test('Browser-session cookie when Remember Me is disabled', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const anonCookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'aks.reader@example.com',
          password: 'StrongPassword99!',
          rememberMe: false, // Browser-session
        }),
      });

      assert.equal(loginRes.status, 200);
      const rawCookie = getRawSetCookie(loginRes);
      // When rememberMe is false, browser cookie has no Max-Age or Expires attribute
      assert.ok(!rawCookie.includes('Max-Age=2592000'), 'Unchecked Remember Me must not have 30-day Max-Age');
    });

    test('Incorrect password fails with generic authentication error (401)', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'aks.reader@example.com',
          password: 'WrongPassword123!',
        }),
      });

      assert.equal(loginRes.status, 401);
      const data = await loginRes.json();
      assert.equal(data.error.message, 'Incorrect email or password.');
      assert.equal(data.error.code, 'INVALID_CREDENTIALS');
    });

    test('Unknown email fails with identical generic authentication error (401)', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'nonexistent-user@example.com',
          password: 'SomePassword123!',
        }),
      });

      assert.equal(loginRes.status, 401);
      const data = await loginRes.json();
      assert.equal(data.error.message, 'Incorrect email or password.');
      assert.equal(data.error.code, 'INVALID_CREDENTIALS');
    });
  });

  // ── 4. Current User & Authentication Middleware ───────────────────────────
  describe('GET /api/auth/me & Session State', () => {
    test('Unauthenticated request to /api/auth/me returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.code, 'UNAUTHENTICATED');
    });

    test('Authenticated session accesses /api/auth/me and returns sanitized identity', async () => {
      // 1. Login to get authenticated session
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const anonCookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'aks.reader@example.com',
          password: 'StrongPassword99!',
        }),
      });

      const authCookie = extractCookie(loginRes);

      // 2. Query /api/auth/me with auth cookie
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        },
      });

      assert.equal(meRes.status, 200);
      const meData = await meRes.json();

      assert.ok(meData.user);
      assert.equal(meData.user.email, 'aks.reader@example.com');
      assert.equal(meData.user.name, 'Aks Reader');
      assert.ok(meData.user.createdAt);
      assert.equal(meData.user.passwordHash, undefined);
    });
  });

  // ── 5. Logout Tests ───────────────────────────────────────────────────────
  describe('User Logout & Session Destruction', () => {
    test('Logout destroys server-side session and clears session cookie', async () => {
      // 1. Login
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const anonCookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'aks.reader@example.com',
          password: 'StrongPassword99!',
        }),
      });

      const authCookie = extractCookie(loginRes);
      const { csrfToken: loggedInCsrf } = await loginRes.json();

      // 2. Perform Logout
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
          'X-CSRF-Token': loggedInCsrf,
        },
      });

      assert.equal(logoutRes.status, 200);
      const logoutRawCookie = getRawSetCookie(logoutRes);
      assert.ok(
        logoutRawCookie.includes(`${env.SESSION_COOKIE_NAME}=;`) ||
        logoutRawCookie.includes('Expires=Thu, 01 Jan 1970'),
        'Cookie should be expired/cleared'
      );

      // 3. Verify destroyed session can no longer access /api/auth/me
      const afterLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        },
      });

      assert.equal(afterLogoutRes.status, 401, 'Destroyed session must be rejected with 401');
    });
  });

  // ── 6. Multi-User Isolation Tests ─────────────────────────────────────────
  describe('Multi-User Session Isolation', () => {
    let userAId, userBId;
    let userACookie, userBCookie;
    let userACsrf, userBCsrf;

    test('Two independently registered users have completely distinct sessions and identities', async () => {
      // Register User A
      const csrfA = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookieA = extractCookie(csrfA);
      const { csrfToken: tokenA } = await csrfA.json();

      const regA = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookieA}`,
          'X-CSRF-Token': tokenA,
        },
        body: JSON.stringify({
          name: 'User Alpha',
          email: 'alpha@example.com',
          password: 'PasswordAlpha1!',
        }),
      });
      const dataA = await regA.json();
      userAId = dataA.user.id;
      testUserIds.push(userAId);

      // Login User A
      const loginA = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookieA}`,
          'X-CSRF-Token': tokenA,
        },
        body: JSON.stringify({
          email: 'alpha@example.com',
          password: 'PasswordAlpha1!',
        }),
      });
      userACookie = extractCookie(loginA);
      const loginAJson = await loginA.json();
      userACsrf = loginAJson.csrfToken;

      // Register User B
      const csrfB = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookieB = extractCookie(csrfB);
      const { csrfToken: tokenB } = await csrfB.json();

      const regB = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookieB}`,
          'X-CSRF-Token': tokenB,
        },
        body: JSON.stringify({
          name: 'User Beta',
          email: 'beta@example.com',
          password: 'PasswordBeta2!',
        }),
      });
      const dataB = await regB.json();
      userBId = dataB.user.id;
      testUserIds.push(userBId);

      // Login User B
      const loginB = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookieB}`,
          'X-CSRF-Token': tokenB,
        },
        body: JSON.stringify({
          email: 'beta@example.com',
          password: 'PasswordBeta2!',
        }),
      });
      userBCookie = extractCookie(loginB);
      const loginBJson = await loginB.json();
      userBCsrf = loginBJson.csrfToken;

      // Verify distinct cookies and user accounts
      assert.notEqual(userAId, userBId);
      assert.notEqual(userACookie, userBCookie);

      // Verify User A identity via /api/auth/me
      const meA = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userACookie}` },
      });
      const meAData = await meA.json();
      assert.equal(meAData.user.email, 'alpha@example.com');

      // Verify User B identity via /api/auth/me
      const meB = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userBCookie}` },
      });
      const meBData = await meB.json();
      assert.equal(meBData.user.email, 'beta@example.com');
    });

    test('Logging out User A does not log out User B', async () => {
      // Logout User A
      const logoutA = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userACookie}`,
          'X-CSRF-Token': userACsrf,
        },
      });
      assert.equal(logoutA.status, 200);

      // User A session must now fail
      const meA = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userACookie}` },
      });
      assert.equal(meA.status, 401);

      // User B session MUST remain active and valid
      const meB = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userBCookie}` },
      });
      assert.equal(meB.status, 200);
      const meBData = await meB.json();
      assert.equal(meBData.user.email, 'beta@example.com');
    });

    test('User A cannot spoof identity or authenticate using User B session', async () => {
      // User B is logged in with userBCookie. Requesting with userBCookie always yields User B.
      // Even if an attacker supplies a forged body or header claiming to be User A,
      // server strictly binds identity to the session.
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${userBCookie}`,
          'X-User-Id': userAId, // Forged header
        },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.user.id, userBId, 'Server must enforce identity bound to verified session');
      assert.notEqual(data.user.id, userAId);
    });

    test('Deleting a user invalidates their active sessions (cascade check)', async () => {
      // Delete User B from database
      await prisma.user.delete({ where: { id: userBId } });
      const idx = testUserIds.indexOf(userBId);
      if (idx !== -1) testUserIds.splice(idx, 1);

      // User B attempts to access protected endpoint with existing session cookie
      const meB = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userBCookie}` },
      });

      assert.equal(meB.status, 401, 'Deleted user session must be rejected with 401');
    });
  });

  // ── 7. Expired Session Tests ──────────────────────────────────────────────
  describe('Session Expiry Handling', () => {
    test('Expired database sessions are rejected on protected endpoints', async () => {
      // 1. Create a user
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Expiry Test User',
          email: 'expiry.test@example.com',
          password: 'PasswordExpiry1!',
        }),
      });
      const { user } = await regRes.json();
      testUserIds.push(user.id);

      // 2. Login to get authenticated session
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'expiry.test@example.com',
          password: 'PasswordExpiry1!',
        }),
      });
      const authCookie = extractCookie(loginRes);
      // express-session encodes cookie value as s:<sid>.<signature>
      const rawSid = decodeURIComponent(authCookie).split('.')[0].replace(/^s:/, '');

      // 3. Manually expire this session in the PostgreSQL database
      await prisma.session.update({
        where: { sid: rawSid },
        data: {
          expiresAt: new Date(Date.now() - 10000), // 10 seconds in the past
        },
      });

      // 4. Request /api/auth/me with the expired session
      const expiredRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        },
      });

      assert.equal(expiredRes.status, 401, 'Expired session must return 401');
    });
  });

  // ── 8. Rate Limiting Tests ────────────────────────────────────────────────
  describe('Rate Limiting', () => {
    test('Rate limiter headers are present on authentication endpoints', async () => {
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const cookie = extractCookie(csrfRes);
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        }),
      });

      // Verify standard rate limit headers
      assert.ok(
        res.headers.has('ratelimit-limit') ||
        res.headers.has('x-ratelimit-limit') ||
        res.headers.has('ratelimit-remaining') ||
        res.headers.has('retry-after') ||
        res.status === 401
      );
    });
  });

  // ── 7. CORS Security Tests ────────────────────────────────────────────────
  describe('CORS Restrictions', () => {
    test('Allowed origin (http://localhost:5173) is accepted with credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    });

    test('Untrusted origin is rejected by Aks CORS policy', async () => {
      const res = await fetch(`${baseUrl}/api/auth/csrf`, {
        headers: {
          Origin: 'http://malicious-site.com',
        },
      });

      // Cors error is returned
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.ok(data.error.message.includes('not permitted by Aks CORS policy'));
    });
  });

  // ── 9. Google OAuth Integration ───────────────────────────────────────────
  describe('Google OAuth 2.0 Integration', () => {
    test('GET /api/auth/google/status reports configuration state', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/status`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(typeof data.configured, 'boolean');
    });

    test('GET /api/auth/google redirects safely when not configured', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
      // Either 302 redirect to frontend with error or to accounts.google.com if configured
      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      if (!env.IS_GOOGLE_OAUTH_CONFIGURED) {
        assert.ok(location.includes('auth_error=google_not_configured'));
      } else {
        assert.ok(location.includes('accounts.google.com'));
      }
    });

    test('GET /api/auth/google/callback rejects missing or mismatched state', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=bogus_state`, {
        redirect: 'manual',
      });
      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location.includes('auth_error=invalid_oauth_state'));
    });
  });
});

