import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { hashPassword } from '../src/services/passwordService.js';
import { DEFAULT_USER_PREFERENCES } from '../src/config/preferences.js';
import { AccountRelationshipService } from '../src/services/accountRelationshipService.js';

describe('Aks (अक्स) Phase ACCOUNT-FIX-1: Registration & Session System Test Suite', () => {
  let server;
  let baseUrl;
  const createdUserIds = [];
  const testPrefix = `test_${Date.now()}`;

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  before(async () => {
    // Clean up only previous automated test run accounts
    await prisma.accountRelationship.deleteMany({
      where: {
        OR: [
          { owner: { email: { contains: 'test_regfix_' } } },
          { user: { email: { contains: 'test_regfix_' } } },
        ],
      },
    }).catch(() => {});
    await prisma.userPreference.deleteMany({
      where: { user: { email: { contains: 'test_regfix_' } } },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: { contains: 'test_regfix_' } },
    }).catch(() => {});

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
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // 1. Successful registration
  test('1. Successful registration: creates account, assigns USER role, returns user metadata without secrets', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Sanctuary Explorer',
        email: 'explorer@aks.sanctuary',
        password: 'Password123!',
      }),
    });

    assert.equal(regRes.status, 201);
    const data = await regRes.json();
    assert.ok(data.user);
    assert.equal(data.user.name, 'Sanctuary Explorer');
    assert.equal(data.user.email, 'explorer@aks.sanctuary');
    assert.equal(data.user.role, 'USER');
    assert.equal(data.user.password, undefined);
    assert.equal(data.user.passwordHash, undefined);
    assert.ok(data.csrfToken, 'Should return fresh CSRF token for the authenticated session');

    createdUserIds.push(data.user.id);

    // Verify DB
    const dbUser = await prisma.user.findUnique({
      where: { id: data.user.id },
      include: { preference: true },
    });
    assert.ok(dbUser);
    assert.equal(dbUser.role, 'USER');
    assert.ok(dbUser.preference, 'Default user preferences must be provisioned');
  });

  // 2. Registration with missing fields
  test('2. Registration with missing fields: rejects with 400 Bad Request', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    // Missing name
    const resNoName = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: 'noname@aks.sanctuary',
        password: 'Password123!',
      }),
    });
    assert.equal(resNoName.status, 400);
    const noNameData = await resNoName.json();
    assert.equal(noNameData.error.message, 'Full name is required.');

    // Missing email
    const resNoEmail = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'No Email User',
        password: 'Password123!',
      }),
    });
    assert.equal(resNoEmail.status, 400);

    // Missing password
    const resNoPass = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'No Pass User',
        email: 'nopass@aks.sanctuary',
      }),
    });
    assert.equal(resNoPass.status, 400);
    const noPassData = await resNoPass.json();
    assert.equal(noPassData.error.message, 'Password is required.');
  });

  // 3. Duplicate email registration
  test('3. Duplicate email registration: returns 409 Conflict with accurate error message', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Another Explorer',
        email: 'explorer@aks.sanctuary', // already created in test 1
        password: 'Password123!',
      }),
    });

    assert.equal(dupRes.status, 409);
    const dupData = await dupRes.json();
    assert.equal(dupData.error.code, 'EMAIL_ALREADY_EXISTS');
    assert.equal(dupData.error.message, 'An account with this email address already exists.');
  });

  // 4. Invalid email
  test('4. Invalid email: rejects with 400 Bad Request', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const invalidEmails = ['plainaddress', 'missingatdomain.com', '@nodomain.com', 'spaces in@email.com'];
    for (const badEmail of invalidEmails) {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Bad Email User',
          email: badEmail,
          password: 'Password123!',
        }),
      });
      assert.equal(res.status, 400, `Expected 400 for bad email: ${badEmail}`);
      const data = await res.json();
      assert.equal(data.error.message, 'Please provide a valid email address.');
    }
  });

  // 5. Invalid password requirements
  test('5. Invalid password: rejects with specific validation messages (not generic error)', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const cases = [
      { pw: 'short', expected: 'Password must be at least 8 characters long.' },
      { pw: 'alllowercase1', expected: 'Password must contain at least one uppercase letter.' },
      { pw: 'ALLUPPERCASE1', expected: 'Password must contain at least one lowercase letter.' },
      { pw: 'NoNumbersInPassword', expected: 'Password must contain at least one number.' },
    ];

    for (const { pw, expected } of cases) {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Invalid PW User',
          email: `invalidpw_${Math.random().toString(36).substring(2, 6)}@aks.sanctuary`,
          password: pw,
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.message, expected);
      assert.equal(data.error.code, 'INVALID_REGISTRATION_INPUT');
    }
  });

  // 6. Public registration cannot create OWNER accounts
  test('6. Public registration cannot create OWNER accounts (role payload is ignored and USER assigned)', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Hacker Attempt',
        email: 'hacker@aks.sanctuary',
        password: 'Password123!',
        role: 'OWNER', // Attempting privilege escalation
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.user.role, 'USER', 'Role must remain USER even if OWNER was requested');
    createdUserIds.push(data.user.id);

    const dbUser = await prisma.user.findUnique({ where: { id: data.user.id } });
    assert.equal(dbUser.role, 'USER');
  });

  // 7. Password is stored as an Argon2id hash
  test('7. Password is stored as an Argon2id hash: never plaintext', async () => {
    const user = await prisma.user.findUnique({
      where: { email: 'explorer@aks.sanctuary' },
    });
    assert.ok(user);
    assert.ok(user.passwordHash.startsWith('$argon2id$v=19$'), 'Password hash must be Argon2id');
    assert.ok(!user.passwordHash.includes('Password123!'), 'Plaintext password must not appear');
  });

  // 8. Session is established after successful registration
  test('8. Session is established after successful registration: cookie allows immediate /api/auth/me access', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Auto Session Reader',
        email: 'autosession@aks.sanctuary',
        password: 'Password123!',
        rememberMe: true,
      }),
    });

    assert.equal(regRes.status, 201);
    const sessionCookie = extractCookie(regRes);
    assert.ok(sessionCookie, 'Registration response MUST set the session cookie');
    const data = await regRes.json();
    createdUserIds.push(data.user.id);

    // Call /api/auth/me immediately using the session cookie from registration response
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
    });

    assert.equal(meRes.status, 200, 'Immediate /api/auth/me should succeed using registration session cookie');
    const meData = await meRes.json();
    assert.equal(meData.user.id, data.user.id);
    assert.equal(meData.user.email, 'autosession@aks.sanctuary');
    assert.equal(meData.user.role, 'USER');
  });

  // 9. Registration failure does not create an authenticated session
  test('9. Registration failure does not create an authenticated session', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const failedRegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        name: 'Fail User',
        email: 'failuser@aks.sanctuary',
        password: 'invalid_password_no_caps',
      }),
    });

    assert.equal(failedRegRes.status, 400);

    // Attempting to access /api/auth/me with either cookie must be rejected (401)
    const errCookie = extractCookie(failedRegRes) || csrfCookie;
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${errCookie}`,
      },
    });

    assert.equal(meRes.status, 401, 'Anonymous/failed session must not have authenticated access');
  });

  // 10. Registration does not create duplicate users after retries
  test('10. Registration does not create duplicate users after retries', async () => {
    const email = 'retry_user@aks.sanctuary';

    const csrfRes1 = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie1 = extractCookie(csrfRes1);
    const { csrfToken: csrfToken1 } = await csrfRes1.json();

    // First attempt succeeds
    const res1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie1}`,
        'X-CSRF-Token': csrfToken1,
      },
      body: JSON.stringify({
        name: 'Retry User',
        email,
        password: 'Password123!',
      }),
    });
    assert.equal(res1.status, 201);
    const data1 = await res1.json();
    createdUserIds.push(data1.user.id);

    // Fetch fresh CSRF token for second attempt from another browser/session
    const csrfRes2 = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie2 = extractCookie(csrfRes2);
    const { csrfToken: csrfToken2 } = await csrfRes2.json();

    // Retry with same email is rejected with 409 Conflict
    const res2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie2}`,
        'X-CSRF-Token': csrfToken2,
      },
      body: JSON.stringify({
        name: 'Retry User',
        email,
        password: 'Password123!',
      }),
    });
    assert.equal(res2.status, 409);
    const data2 = await res2.json();
    assert.equal(data2.error.code, 'EMAIL_ALREADY_EXISTS');

    // Check PostgreSQL: exactly one record exists
    const count = await prisma.user.count({ where: { email } });
    assert.equal(count, 1, 'Only one user record must exist in PostgreSQL');
  });

  // 11. CSRF handling works
  test('11. CSRF handling works: missing or invalid tokens reject with 403', async () => {
    // Missing token
    const res1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'CSRF Missing User',
        email: 'csrfmissing@aks.sanctuary',
        password: 'Password123!',
      }),
    });
    assert.equal(res1.status, 403);
    const data1 = await res1.json();
    assert.equal(data1.error.code, 'EBADCSRFTOKEN');

    // Invalid token
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);

    const res2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: JSON.stringify({
        name: 'CSRF Bad User',
        email: 'csrfbad@aks.sanctuary',
        password: 'Password123!',
      }),
    });
    assert.equal(res2.status, 403);
    const data2 = await res2.json();
    assert.equal(data2.error.code, 'EBADCSRFTOKEN');
  });

  // 12. Login continues working
  test('12. Login continues working for registered accounts', async () => {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: 'explorer@aks.sanctuary',
        password: 'Password123!',
        rememberMe: true,
      }),
    });

    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.email, 'explorer@aks.sanctuary');
    assert.equal(loginData.user.role, 'USER');
    assert.ok(loginData.csrfToken);

    const loginCookie = extractCookie(loginRes);
    assert.ok(loginCookie);

    // Verify session identity
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${loginCookie}`,
      },
    });
    assert.equal(meRes.status, 200);
  });

  // 13. Existing Owner authentication remains functional
  test('13. Existing Owner authentication remains functional (preserves OWNER role)', async () => {
    // Create an owner account directly in database
    const ownerEmail = 'existing_owner@aks.sanctuary';
    const passwordHash = await hashPassword('OwnerPass123!');
    const ownerUser = await prisma.user.create({
      data: {
        name: 'Sanctuary Owner',
        email: ownerEmail,
        passwordHash,
        role: 'OWNER',
        preference: { create: DEFAULT_USER_PREFERENCES },
      },
    });
    createdUserIds.push(ownerUser.id);

    // Log in as Owner
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: ownerEmail,
        password: 'OwnerPass123!',
      }),
    });

    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.role, 'OWNER');

    const ownerCookie = extractCookie(loginRes);
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${ownerCookie}`,
      },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.role, 'OWNER');
  });

  // 14. Existing Owner Access functionality remains unaffected
  test('14. Existing Owner Access functionality remains unaffected', async () => {
    // We already have ownerUser and explorer user created
    const owner = await prisma.user.findUnique({ where: { email: 'existing_owner@aks.sanctuary' } });
    const user = await prisma.user.findUnique({ where: { email: 'explorer@aks.sanctuary' } });
    assert.ok(owner);
    assert.ok(user);

    // Link owner to user
    await AccountRelationshipService.linkUser({
      ownerId: owner.id,
      targetUserId: user.id,
    });

    // Owner logs in
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfCookie = extractCookie(csrfRes);
    const { csrfToken } = await csrfRes.json();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${env.SESSION_COOKIE_NAME}=${csrfCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: 'existing_owner@aks.sanctuary',
        password: 'OwnerPass123!',
      }),
    });
    const ownerCookie = extractCookie(loginRes);

    // Owner checks owner-access status
    const statusRes = await fetch(`${baseUrl}/api/account/owner-access/current`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${ownerCookie}`,
      },
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.active, false);
  });
});
