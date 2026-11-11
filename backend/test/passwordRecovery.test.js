import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { hashPassword } from '../src/services/passwordService.js';
import { DEFAULT_USER_PREFERENCES } from '../src/config/preferences.js';

describe('Aks (अक्स) Phase AUTH-3: Email + Mobile Number Password Recovery Verification Suite', () => {
  let server;
  let baseUrl;
  const testRunId = Date.now();

  const userAEmail = `recovery_usera_${testRunId}@aks.sanctuary`;
  const userAMobile = '+919876543210';
  const userAPassword = 'UserAPassword123!';

  const userBEmail = `recovery_userb_${testRunId}@aks.sanctuary`;
  const userBMobile = '+919876543211';
  const userBPassword = 'UserBPassword123!';

  const legacyEmail = `recovery_legacy_${testRunId}@aks.sanctuary`;
  const legacyMobile = '+919876543212';
  const legacyPassword = 'LegacyPassword123!';

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
    // 1. Clean up any leftover test accounts
    await prisma.user.deleteMany({
      where: { email: { contains: 'recovery_' } },
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

    // 3. Seed User A with email and mobile number
    const passwordHashA = await hashPassword(userAPassword);
    const userA = await prisma.user.create({
      data: {
        name: 'User A',
        email: userAEmail,
        mobileNumber: userAMobile,
        passwordHash: passwordHashA,
        preference: { create: DEFAULT_USER_PREFERENCES },
      },
    });
    createdUserIds.push(userA.id);

    // 4. Seed User B with email and mobile number
    const passwordHashB = await hashPassword(userBPassword);
    const userB = await prisma.user.create({
      data: {
        name: 'User B',
        email: userBEmail,
        mobileNumber: userBMobile,
        passwordHash: passwordHashB,
        preference: { create: DEFAULT_USER_PREFERENCES },
      },
    });
    createdUserIds.push(userB.id);

    // 5. Seed legacy user without mobile number
    const passwordHashLegacy = await hashPassword(legacyPassword);
    const userLegacy = await prisma.user.create({
      data: {
        name: 'Legacy User',
        email: legacyEmail,
        mobileNumber: null, // No mobile number initially
        passwordHash: passwordHashLegacy,
        preference: { create: DEFAULT_USER_PREFERENCES },
      },
    });
    createdUserIds.push(userLegacy.id);
  });

  after(async () => {
    try {
      if (createdUserIds.length > 0) {
        await prisma.passwordRecoveryToken.deleteMany({
          where: { userId: { in: createdUserIds } },
        }).catch(() => {});
        await prisma.session.deleteMany({
          where: { userId: { in: createdUserIds } },
        }).catch(() => {});
        await prisma.userPreference.deleteMany({
          where: { userId: { in: createdUserIds } },
        }).catch(() => {});
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        }).catch(() => {});
      }
    } catch (_) {}

    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── Scenario 1 ─────────────────────────────────────────────────────────────
  test('1. Correct email + correct mobile number -> returns success status code 200 and valid authorization payload', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const res = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: userAEmail,
        mobileNumber: userAMobile,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.recoveryToken, 'string');
    assert.ok(body.recoveryToken.length >= 32);
    assert.ok(body.expiresAt);
    assert.match(body.message, /verified/i);
  });

  // ── Scenario 2 ─────────────────────────────────────────────────────────────
  test('2. Correct email + incorrect mobile number -> rejected with generic 400 error message', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const res = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: userAEmail,
        mobileNumber: '+919999999999', // Incorrect mobile
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'INVALID_RECOVERY_CREDENTIALS');
    assert.equal(body.error?.message, 'The provided email and mobile number combination could not be verified.');
  });

  // ── Scenario 3 ─────────────────────────────────────────────────────────────
  test('3. Incorrect email + correct mobile number -> rejected with generic 400 error message', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const res = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: `nonexistent_${testRunId}@aks.sanctuary`,
        mobileNumber: userAMobile,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'INVALID_RECOVERY_CREDENTIALS');
    assert.equal(body.error?.message, 'The provided email and mobile number combination could not be verified.');
  });

  // ── Scenario 4 ─────────────────────────────────────────────────────────────
  test('4. Both email and mobile number incorrect -> rejected with generic 400 error message', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const res = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: `random_unknown_${testRunId}@aks.sanctuary`,
        mobileNumber: '+919000000000',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'INVALID_RECOVERY_CREDENTIALS');
    assert.equal(body.error?.message, 'The provided email and mobile number combination could not be verified.');
  });

  // ── Scenario 5 ─────────────────────────────────────────────────────────────
  test('5. Email of User A + mobile number of User B -> rejected with generic 400 error message', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    const res = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: userAEmail,
        mobileNumber: userBMobile, // Belongs to User B
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'INVALID_RECOVERY_CREDENTIALS');
    assert.equal(body.error?.message, 'The provided email and mobile number combination could not be verified.');
  });

  // ── Scenario 6 ─────────────────────────────────────────────────────────────
  test('6. Expired recovery authorization -> rejected when attempting to submit password reset', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    // Verify User A credentials to get token
    const verifyRes = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: userAEmail,
        mobileNumber: userAMobile,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const { recoveryToken } = await verifyRes.json();

    // Manually expire the token in database
    await prisma.passwordRecoveryToken.updateMany({
      where: { userId: createdUserIds[0] },
      data: { expiresAt: new Date(Date.now() - 60000) }, // 1 minute in the past
    });

    // Attempt to reset password with expired token
    const resetRes = await fetch(`${baseUrl}/api/auth/recovery/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        recoveryToken,
        newPassword: 'NewExpiredPassword123!',
        confirmPassword: 'NewExpiredPassword123!',
      }),
    });

    assert.equal(resetRes.status, 400);
    const resetBody = await resetRes.json();
    assert.equal(resetBody.error?.code, 'INVALID_OR_EXPIRED_TOKEN');
  });

  // ── Scenario 7 ─────────────────────────────────────────────────────────────
  test('7. Reused recovery authorization -> rejected (single-use only)', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    // Verify User A credentials to get a fresh token
    const verifyRes = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: userAEmail,
        mobileNumber: userAMobile,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const { recoveryToken } = await verifyRes.json();

    // First reset: must succeed
    const firstResetRes = await fetch(`${baseUrl}/api/auth/recovery/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        recoveryToken,
        newPassword: 'FreshResetPassword123!',
        confirmPassword: 'FreshResetPassword123!',
      }),
    });
    assert.equal(firstResetRes.status, 200);
    const firstBody = await firstResetRes.json();
    assert.equal(firstBody.success, true);

    // Second reset using the same token: must fail
    const secondResetRes = await fetch(`${baseUrl}/api/auth/recovery/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        recoveryToken,
        newPassword: 'AnotherPassword123!',
        confirmPassword: 'AnotherPassword123!',
      }),
    });
    assert.equal(secondResetRes.status, 400);
    const secondBody = await secondResetRes.json();
    assert.ok(
      secondBody.error?.code === 'TOKEN_ALREADY_USED' ||
      secondBody.error?.code === 'INVALID_OR_EXPIRED_TOKEN'
    );
  });

  // ── Scenario 8 ─────────────────────────────────────────────────────────────
  test('8. Concurrent reset attempts with same recovery authorization -> exactly one succeeds, others fail atomically', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    // Generate fresh recovery authorization token
    const verifyRes = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: userAEmail,
        mobileNumber: userAMobile,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const { recoveryToken } = await verifyRes.json();

    // Fire 3 simultaneous concurrent reset requests
    const attempts = await Promise.all([
      fetch(`${baseUrl}/api/auth/recovery/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        },
        body: JSON.stringify({
          recoveryToken,
          newPassword: 'ConcurrentPassword123A!',
          confirmPassword: 'ConcurrentPassword123A!',
        }),
      }),
      fetch(`${baseUrl}/api/auth/recovery/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        },
        body: JSON.stringify({
          recoveryToken,
          newPassword: 'ConcurrentPassword123B!',
          confirmPassword: 'ConcurrentPassword123B!',
        }),
      }),
      fetch(`${baseUrl}/api/auth/recovery/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        },
        body: JSON.stringify({
          recoveryToken,
          newPassword: 'ConcurrentPassword123C!',
          confirmPassword: 'ConcurrentPassword123C!',
        }),
      }),
    ]);

    const statuses = attempts.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 200).length;
    const failCount = statuses.filter((s) => s === 400).length;

    assert.equal(successCount, 1, 'Exactly one concurrent reset must succeed');
    assert.equal(failCount, 2, 'All other concurrent reset attempts must be atomically rejected');
  });

  // ── Scenario 9 ─────────────────────────────────────────────────────────────
  test('9. Rate-limit enforcement on recovery endpoint -> 429 after threshold in strict mode', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    // Send rapid recovery verification attempts with explicit rate limit testing
    let hitRateLimit = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'x-test-rate-limit': 'true',
          Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
        },
        body: JSON.stringify({
          email: userBEmail,
          mobileNumber: '+919999999999',
        }),
      });

      if (res.status === 429) {
        hitRateLimit = true;
        const body = await res.json();
        assert.match(body.error?.message || '', /too many recovery attempts/i);
        break;
      }
    }

    assert.equal(hitRateLimit, true, 'Must enforce rate limiting when rate limit testing is enabled');
  });

  // ── Scenario 10 ────────────────────────────────────────────────────────────
  test('10. Session revocation after password reset -> all active sessions for that account invalidated', async () => {
    // 1. Establish an authenticated session for User B
    const { csrfToken: initialCsrf, sessionCookie: initialCookie } = await getCsrfToken();
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': initialCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${initialCookie}`,
      },
      body: JSON.stringify({
        email: userBEmail,
        password: userBPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const activeUserBSessionCookie = extractCookie(loginRes) || initialCookie;

    // 2. Verify session is currently active
    const meResBefore = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${activeUserBSessionCookie}`,
      },
    });
    assert.equal(meResBefore.status, 200);
    const meBody = await meResBefore.json();
    assert.equal(meBody.user.email, userBEmail);

    // 3. Initiate recovery from a separate context/browser
    const { csrfToken: recCsrf, sessionCookie: recCookie } = await getCsrfToken();
    const verifyRes = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': recCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${recCookie}`,
      },
      body: JSON.stringify({
        email: userBEmail,
        mobileNumber: userBMobile,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const { recoveryToken } = await verifyRes.json();

    // 4. Reset User B password
    const newPasswordForB = 'RevokeTestPassword123!';
    const resetRes = await fetch(`${baseUrl}/api/auth/recovery/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': recCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${recCookie}`,
      },
      body: JSON.stringify({
        recoveryToken,
        newPassword: newPasswordForB,
        confirmPassword: newPasswordForB,
      }),
    });
    assert.equal(resetRes.status, 200);

    // 5. Test that the previous active session is now REVOKED (401 Unauthorized)
    const meResAfter = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${activeUserBSessionCookie}`,
      },
    });
    assert.equal(meResAfter.status, 401, 'Prior active session must be invalidated upon password reset');

    // 6. Test that logging in with the old password fails (401)
    const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': recCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${recCookie}`,
      },
      body: JSON.stringify({
        email: userBEmail,
        password: userBPassword,
      }),
    });
    assert.equal(oldLoginRes.status, 401);

    // 7. Test that logging in with the new password succeeds (200)
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': recCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${recCookie}`,
      },
      body: JSON.stringify({
        email: userBEmail,
        password: newPasswordForB,
      }),
    });
    assert.equal(newLoginRes.status, 200);
  });

  // ── Scenario 11 ────────────────────────────────────────────────────────────
  test('11. Existing accounts without mobile numbers -> recovery rejected, mobile number can be added via profile, then recovery succeeds', async () => {
    const { csrfToken: initialCsrf, sessionCookie: initialCookie } = await getCsrfToken();

    // 1. Password recovery attempt on legacy account without mobile number must fail
    const recoveryFailRes = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': initialCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${initialCookie}`,
      },
      body: JSON.stringify({
        email: legacyEmail,
        mobileNumber: legacyMobile,
      }),
    });
    assert.equal(recoveryFailRes.status, 400);

    // 2. User logs into legacy account
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': initialCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${initialCookie}`,
      },
      body: JSON.stringify({
        email: legacyEmail,
        password: legacyPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const legacyCookie = extractCookie(loginRes) || initialCookie;
    const loginBody = await loginRes.json();
    assert.equal(loginBody.user.hasMobileNumber, false);
    assert.equal(loginBody.user.mobileNumberMasked, null);

    // 3. User updates profile to add mobile number via PATCH /api/auth/profile
    const { csrfToken: authCsrf } = await getCsrfToken(legacyCookie);
    const profileRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': authCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${legacyCookie}`,
      },
      body: JSON.stringify({
        mobileNumber: legacyMobile,
      }),
    });
    assert.equal(profileRes.status, 200);
    const profileBody = await profileRes.json();
    assert.equal(profileBody.user.hasMobileNumber, true);
    assert.ok(profileBody.user.mobileNumberMasked.includes('3212'));

    // 4. Now password recovery must succeed with the registered mobile number
    const { csrfToken: recCsrf, sessionCookie: recCookie } = await getCsrfToken();
    const recoverySuccessRes = await fetch(`${baseUrl}/api/auth/recovery/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': recCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${recCookie}`,
      },
      body: JSON.stringify({
        email: legacyEmail,
        mobileNumber: legacyMobile,
      }),
    });
    assert.equal(recoverySuccessRes.status, 200);
    const recBody = await recoverySuccessRes.json();
    assert.ok(recBody.recoveryToken);
  });

  // ── Scenario 12 ────────────────────────────────────────────────────────────
  test('12. Registration with duplicate mobile number -> rejected with HTTP 409 Conflict', async () => {
    const { csrfToken, sessionCookie } = await getCsrfToken();

    // Attempt to register a new account using User A's already registered mobile number
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: `${env.SESSION_COOKIE_NAME}=${sessionCookie}`,
      },
      body: JSON.stringify({
        email: `new_user_dup_mobile_${testRunId}@aks.sanctuary`,
        password: 'UniquePassword123!',
        name: 'Duplicate Mobile User',
        mobileNumber: userAMobile, // Already registered to User A
      }),
    });

    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json();
    assert.equal(dupBody.error?.code, 'MOBILE_ALREADY_EXISTS');
    assert.match(dupBody.error?.message || '', /mobile number already exists/i);
  });
});
