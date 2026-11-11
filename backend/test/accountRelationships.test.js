import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { AccountRelationshipService } from '../src/services/accountRelationshipService.js';

describe('Aks (अक्स) Phase ACCOUNT-1A: Owner/User Roles & Account Relationships Test Suite', () => {
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
    // 1. Get initial CSRF
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

    // Fetch fresh CSRF token before login to guarantee CSRF token sync
    const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${currentCookie}` },
    });
    const { csrfToken: loginCsrf } = await loginCsrfRes.json();
    const postCsrfCookie = extractCookie(loginCsrfRes);
    if (postCsrfCookie) currentCookie = postCsrfCookie;

    // If a specific role is requested for testing setup (e.g. OWNER), update directly in DB
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

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await prisma.accountRelationship.deleteMany({
        where: {
          OR: [
            { ownerId: { in: createdUserIds } },
            { userId: { in: createdUserIds } },
          ],
        },
      }).catch(() => {});

      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      }).catch(() => {});
    }

    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
  });

  describe('1. Role Initialization & Registration Protections', () => {
    test('1. New registrations always receive USER role by default', async () => {
      const email = `role_default_${Date.now()}@example.com`;
      const user = await createAuthenticatedUser('Normal Reader', email);

      assert.equal(user.user.role, 'USER');

      // Verify directly in database
      const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
      assert.equal(dbUser.role, 'USER');
    });

    test('2. Client cannot register as OWNER even if role is provided in request body', async () => {
      const email = `role_exploit_${Date.now()}@example.com`;
      const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
      const { csrfToken } = await csrfRes.json();
      const cookie = extractCookie(csrfRes);

      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${cookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Hacker',
          email,
          password: 'Password123!',
          role: 'OWNER', // Attempted privilege escalation
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      createdUserIds.push(data.user.id);

      // Verify the role remains strictly USER
      assert.equal(data.user.role, 'USER');
      const dbUser = await prisma.user.findUnique({ where: { id: data.user.id } });
      assert.equal(dbUser.role, 'USER');
    });

    test('3. User cannot promote themselves through preference or settings APIs', async () => {
      const email = `role_promo_${Date.now()}@example.com`;
      const user = await createAuthenticatedUser('Regular User', email);

      // Attempt PATCH to preferences with role payload
      const patchRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.authCookie}`,
          'X-CSRF-Token': user.csrfToken,
        },
        body: JSON.stringify({
          role: 'OWNER',
        }),
      });

      // Role must remain USER in DB
      const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
      assert.equal(dbUser.role, 'USER');
    });
  });

  describe('2. Owner/User Relationship Foundation & Management', () => {
    let ownerA;
    let ownerB;
    let managedUser1;
    let managedUser2;

    before(async () => {
      ownerA = await createAuthenticatedUser('Owner A', `owner_a_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      ownerB = await createAuthenticatedUser('Owner B', `owner_b_${Date.now()}@example.com`, 'Password123!', 'OWNER');
      managedUser1 = await createAuthenticatedUser('User One', `user_1_${Date.now()}@example.com`);
      managedUser2 = await createAuthenticatedUser('User Two', `user_2_${Date.now()}@example.com`);
    });

    test('4. Owner can link an eligible User by email or targetUserId', async () => {
      const res = await fetch(`${baseUrl}/api/account/relationships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
          'X-CSRF-Token': ownerA.csrfToken,
        },
        body: JSON.stringify({
          targetEmail: managedUser1.email,
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.relationship.userId, managedUser1.userId);
      assert.equal(data.relationship.status, 'ACTIVE');
      assert.equal(data.relationship.user.email, managedUser1.email);
    });

    test('5. Duplicate active relationship is rejected with 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/account/relationships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
          'X-CSRF-Token': ownerA.csrfToken,
        },
        body: JSON.stringify({
          targetUserId: managedUser1.userId,
        }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.error.code, 'RELATIONSHIP_ALREADY_EXISTS');
    });

    test('6. Self-linking is rejected with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/account/relationships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
          'X-CSRF-Token': ownerA.csrfToken,
        },
        body: JSON.stringify({
          targetUserId: ownerA.userId,
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.code, 'CANNOT_LINK_SELF');
    });

    test('7. Normal User cannot create relationships (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/account/relationships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${managedUser2.authCookie}`,
          'X-CSRF-Token': managedUser2.csrfToken,
        },
        body: JSON.stringify({
          targetUserId: managedUser1.userId,
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'FORBIDDEN_ROLE_REQUIRED');
    });

    test('8. Owner cannot link another Owner account', async () => {
      const res = await fetch(`${baseUrl}/api/account/relationships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
          'X-CSRF-Token': ownerA.csrfToken,
        },
        body: JSON.stringify({
          targetEmail: ownerB.email,
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error.code, 'CANNOT_LINK_OWNER');
    });

    test('9. Owner cannot access another Owner\'s linked Users', async () => {
      // Owner B attempts to revoke Owner A's relationship with managedUser1
      const res = await fetch(`${baseUrl}/api/account/relationships/${managedUser1.userId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerB.authCookie}`,
          'X-CSRF-Token': ownerB.csrfToken,
        },
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error.code, 'RELATIONSHIP_NOT_FOUND');
    });

    test('10. Owner can list their own linked Users and sensitive data is not leaked', async () => {
      // Also link managedUser2 to ownerA
      await fetch(`${baseUrl}/api/account/relationships`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
          'X-CSRF-Token': ownerA.csrfToken,
        },
        body: JSON.stringify({
          targetUserId: managedUser2.userId,
        }),
      });

      const res = await fetch(`${baseUrl}/api/account/relationships`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
        },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.relationships));
      assert.equal(data.relationships.length, 2);

      // Verify no sensitive fields in user object
      const firstRel = data.relationships[0];
      assert.strictEqual(firstRel.user.passwordHash, undefined);
      assert.strictEqual(firstRel.user.password, undefined);
      assert.ok(firstRel.user.name);
      assert.ok(firstRel.user.email);
    });

    test('11. Owner can revoke a relationship', async () => {
      const res = await fetch(`${baseUrl}/api/account/relationships/${managedUser2.userId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${ownerA.authCookie}`,
          'X-CSRF-Token': ownerA.csrfToken,
        },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.relationship.status, 'REVOKED');

      // Verify in DB
      const dbRel = await prisma.accountRelationship.findUnique({
        where: { userId: managedUser2.userId },
      });
      assert.equal(dbRel.status, 'REVOKED');
    });

    test('12. Revoked relationships cannot be reused for authorization', async () => {
      const isAuthorized = await AccountRelationshipService.verifyOwnerUserRelationship(
        ownerA.userId,
        managedUser2.userId
      );
      assert.equal(isAuthorized, false, 'Revoked relationship must not be authorized');
    });
  });

  describe('3. Existing Authentication & Data Preservation', () => {
    test('13. Existing authentication and /api/auth/me still works seamlessly with role', async () => {
      const email = `auth_compat_${Date.now()}@example.com`;
      const user = await createAuthenticatedUser('Compat User', email);

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.authCookie}`,
        },
      });

      assert.equal(meRes.status, 200);
      const meData = await meRes.json();
      assert.equal(meData.user.id, user.userId);
      assert.equal(meData.user.email, email);
      assert.equal(meData.user.role, 'USER');
    });

    test('14. Existing user data (books, notes, preferences) remains accessible to rightful owner', async () => {
      const email = `data_owner_${Date.now()}@example.com`;
      const user = await createAuthenticatedUser('Book Owner', email);

      // Create a book
      const bookRes = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.authCookie}`,
          'X-CSRF-Token': user.csrfToken,
        },
        body: JSON.stringify({
          title: 'Preserved Library Volume',
          author: 'Aks Author',
          totalPages: 100,
        }),
      });

      assert.equal(bookRes.status, 201);
      const bookData = await bookRes.json();

      // Retrieve the book
      const getRes = await fetch(`${baseUrl}/api/books/${bookData.book.id}`, {
        headers: {
          Cookie: `${env.SESSION_COOKIE_NAME}=${user.authCookie}`,
        },
      });

      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.book.id, bookData.book.id);
      assert.equal(getData.book.title, 'Preserved Library Volume');
    });
  });
});
