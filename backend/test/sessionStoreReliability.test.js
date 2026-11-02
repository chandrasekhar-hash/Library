import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { sessionStore } from '../src/services/sessionStore.js';

describe('ISSUE-SEC-01: Session Store Persistence & Reliability Suite', () => {
  let server;
  let baseUrl;
  const createdUserIds = [];

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  function parseRawSid(cookieValue) {
    if (!cookieValue) return null;
    return decodeURIComponent(cookieValue).split('.')[0].replace(/^s:/, '');
  }

  // Helper to register and log in a user, returning valid authenticated credentials
  async function registerAndLogin(email, password, { rememberMe = false } = {}) {
    // 1. Get initial CSRF token and anonymous cookie
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const { csrfToken: initCsrf } = await csrfRes.json();
    const initCookie = extractCookie(csrfRes);

    // 2. Register user
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${initCookie}`,
        'X-CSRF-Token': initCsrf,
      },
      body: JSON.stringify({
        name: 'Test Reader',
        email,
        password,
      }),
    });
    const regData = await regRes.json();
    assert.equal(regRes.status, 201, `Registration failed: ${JSON.stringify(regData)}`);
    createdUserIds.push(regData.user.id);

    // 3. Login with credentials to establish authenticated session
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${initCookie}`,
        'X-CSRF-Token': initCsrf,
      },
      body: JSON.stringify({
        email,
        password,
        rememberMe,
      }),
    });
    const loginData = await loginRes.json();
    assert.equal(loginRes.status, 200, `Login failed: ${JSON.stringify(loginData)}`);
    const authCookie = extractCookie(loginRes);

    return {
      user: loginData.user,
      authCookie,
      csrfToken: loginData.csrfToken,
      rawSetCookie: loginRes.headers.get('set-cookie') || '',
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
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await prisma.session.deleteMany();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // 1. Session creation
  test('1. Session creation — CSRF endpoint persists session in PostgreSQL', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(csrfRes.status, 200);
    const sessionCookie = extractCookie(csrfRes);
    assert.ok(sessionCookie, 'Cookie must be issued');

    const sid = parseRawSid(sessionCookie);
    const dbSession = await prisma.session.findUnique({ where: { sid } });
    assert.ok(dbSession, 'Session must exist in PostgreSQL Session table');
    assert.ok(dbSession.data.includes('csrfToken'), 'Session data must include csrfToken');
  });

  // 2. Session persistence across backend restarts
  test('2. Session persistence across backend restarts — Authenticated session survives server reboot', async () => {
    const email = `restart.test.${Date.now()}@example.com`;
    const password = 'Password123!';
    const { user, authCookie } = await registerAndLogin(email, password);

    // Verify authenticated session works on active server
    const meRes1 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    assert.equal(meRes1.status, 200);
    const meData1 = await meRes1.json();
    assert.equal(meData1.user.email, email);

    // SIMULATE BACKEND RESTART: Terminate server completely
    await new Promise((resolve) => server.close(resolve));

    // Spin up a brand new server instance sharing the same database
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Make request using previous session cookie on the new server instance
    const meRes2 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    assert.equal(meRes2.status, 200, 'Session must remain authenticated after backend restart');
    const meData2 = await meRes2.json();
    assert.equal(meData2.user.id, user.id);
    assert.equal(meData2.user.email, email);
  });

  // 3. Session expiration and cleanup
  test('3. Session expiration — Expired sessions are rejected and pruned', async () => {
    const email = `expire.test.${Date.now()}@example.com`;
    const password = 'Password123!';
    const { authCookie } = await registerAndLogin(email, password);
    const sid = parseRawSid(authCookie);
    assert.ok(sid, 'sid must exist');

    // Force expire in DB
    await prisma.session.update({
      where: { sid },
      data: { expiresAt: new Date(Date.now() - 5000) },
    });

    // Request should fail with 401 and get() triggers async self-destruction
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    assert.equal(meRes.status, 401, 'Expired session must return 401');

    // Wait 50ms for async destroy callback to finish
    await new Promise((r) => setTimeout(r, 50));
    const checkDbAccessed = await prisma.session.findUnique({ where: { sid } });
    assert.equal(checkDbAccessed, null, 'Expired session accessed via get() must be deleted');

    // Now test batch pruning utility on an unaccessed expired session
    const orphanedSid = `orphaned-expired-${Date.now()}`;
    await prisma.session.create({
      data: {
        sid: orphanedSid,
        data: JSON.stringify({ cookie: { maxAge: 1000 } }),
        expiresAt: new Date(Date.now() - 10000),
      },
    });

    const pruned = await sessionStore.pruneExpiredSessions();
    assert.ok(pruned >= 1, 'Pruned count must be >= 1 for unaccessed expired session');
    const checkDbOrphan = await prisma.session.findUnique({ where: { sid: orphanedSid } });
    assert.equal(checkDbOrphan, null, 'Orphaned expired session must be pruned');
  });

  // 4. Logout invalidation
  test('4. Logout invalidation — Session is destroyed in DB and cookie cleared', async () => {
    const email = `logout.test.${Date.now()}@example.com`;
    const password = 'Password123!';
    const { authCookie, csrfToken } = await registerAndLogin(email, password);
    const sid = parseRawSid(authCookie);

    // Perform logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    assert.equal(logoutRes.status, 200);

    // Verify session record is destroyed in DB
    const checkDb = await prisma.session.findUnique({ where: { sid } });
    assert.equal(checkDb, null, 'Session record must be destroyed upon logout');

    // Subsequent /me call with previous cookie must return 401
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    assert.equal(meRes.status, 401);
  });

  // 5. Login session regeneration
  test('5. Login session regeneration — Session ID changes upon login to prevent session fixation', async () => {
    // 1. Initial anonymous session
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const { csrfToken: preAuthCsrf } = await csrfRes.json();
    const preAuthCookie = extractCookie(csrfRes);
    const preAuthSid = parseRawSid(preAuthCookie);

    // 2. Register user
    const email = `fixation.test.${Date.now()}@example.com`;
    const password = 'Password123!';
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${preAuthCookie}`,
        'X-CSRF-Token': preAuthCsrf,
      },
      body: JSON.stringify({ name: 'Fixation User', email, password }),
    });
    const regData = await regRes.json();
    createdUserIds.push(regData.user.id);

    // 3. Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${preAuthCookie}`,
        'X-CSRF-Token': preAuthCsrf,
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);
    const postAuthCookie = extractCookie(loginRes);
    const postAuthSid = parseRawSid(postAuthCookie);

    assert.notEqual(preAuthSid, postAuthSid, 'Session ID must be regenerated on login');
    const postAuthDb = await prisma.session.findUnique({ where: { sid: postAuthSid } });
    assert.ok(postAuthDb, 'New regenerated session must be persisted in DB');
    assert.equal(postAuthDb.userId, regData.user.id);
  });

  // 6. Remember Me behavior
  test('6. Remember Me behavior — Sets 30-day maxAge vs session cookie when rememberMe is true', async () => {
    const email = `remember.test.${Date.now()}@example.com`;
    const password = 'Password123!';
    const { rawSetCookie, authCookie } = await registerAndLogin(email, password, { rememberMe: true });

    assert.ok(
      rawSetCookie.toLowerCase().includes('max-age=') || rawSetCookie.toLowerCase().includes('expires='),
      'Must set Max-Age or Expires header when rememberMe is true'
    );

    const rememberSid = parseRawSid(authCookie);
    const dbSession = await prisma.session.findUnique({ where: { sid: rememberSid } });
    const expiresDurationDays = (new Date(dbSession.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    assert.ok(expiresDurationDays > 28 && expiresDurationDays <= 31, 'Expires duration should be approximately 30 days');
  });

  // 7. Concurrent session updates
  test('7. Concurrent session updates — Multiple parallel requests update session safely', async () => {
    const email = `concurrent.test.${Date.now()}@example.com`;
    const password = 'Password123!';
    const { authCookie } = await registerAndLogin(email, password);

    // Fire 10 parallel requests using the same session
    const parallelRequests = Array.from({ length: 10 }).map(() =>
      fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
      })
    );

    const responses = await Promise.all(parallelRequests);
    for (const res of responses) {
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.user.email, email);
    }
  });

  // 8. Cross-account isolation
  test('8. Cross-account isolation — Distinct users have isolated sessions and data', async () => {
    const emailA = `alice.${Date.now()}@example.com`;
    const emailB = `bob.${Date.now()}@example.com`;
    const password = 'Password123!';

    const userA = await registerAndLogin(emailA, password);
    const userB = await registerAndLogin(emailB, password);

    // Verify session A returns Alice
    const meA = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userA.authCookie}` },
    });
    const profileA = await meA.json();
    assert.equal(profileA.user.id, userA.user.id);

    // Verify session B returns Bob
    const meB = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${userB.authCookie}` },
    });
    const profileB = await meB.json();
    assert.equal(profileB.user.id, userB.user.id);

    // Sessions are strictly distinct in DB
    const sidA = parseRawSid(userA.authCookie);
    const sidB = parseRawSid(userB.authCookie);
    assert.notEqual(sidA, sidB);

    const sessionRecordA = await prisma.session.findUnique({ where: { sid: sidA } });
    const sessionRecordB = await prisma.session.findUnique({ where: { sid: sidB } });
    assert.equal(sessionRecordA.userId, userA.user.id);
    assert.equal(sessionRecordB.userId, userB.user.id);
  });
});
