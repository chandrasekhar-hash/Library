import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { DevanagariSearchNormalizer } from '../src/utils/devanagariNormalizer.js';

describe('Aks — Phase OCR-3B: Multilingual Search API & Matching Engine Test Suite', () => {
  let server;
  let baseUrl;
  let userA;
  let userB;

  const testUserIds = [];
  const testBookIds = [];

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // Create shared test users (userA and userB)
    userA = await createAuthenticatedUser('Scholar Alpha', `scholar_a_${Date.now()}@aks.library`, 'SecurePass123!');
    userB = await createAuthenticatedUser('Scholar Beta', `scholar_b_${Date.now()}@aks.library`, 'SecurePass123!');
  });

  after(async () => {
    if (testBookIds.length > 0) {
      await prisma.bookPageOcr.deleteMany({ where: { bookId: { in: testBookIds } } }).catch(() => {});
      await prisma.ocrJob.deleteMany({ where: { bookId: { in: testBookIds } } }).catch(() => {});
      await prisma.bookFile.deleteMany({ where: { bookId: { in: testBookIds } } }).catch(() => {});
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } }).catch(() => {});
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } }).catch(() => {});
    }
    if (server) await new Promise((res) => server.close(res));
  });

  function extractCookie(res, cookieName = env.SESSION_COOKIE_NAME) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  async function createAuthenticatedUser(name, email, password) {
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const anonCookie = extractCookie(csrfRes);
    const { csrfToken: regCsrf } = await csrfRes.json();

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': regCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${anonCookie}`,
      },
      body: JSON.stringify({ name, email, password }),
    });

    const regData = await regRes.json();
    const userId = regData.user.id;
    testUserIds.push(userId);

    const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const { csrfToken: loginCsrf } = await loginCsrfRes.json();
    const loginCookie = extractCookie(loginCsrfRes);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': loginCsrf,
        Cookie: `${env.SESSION_COOKIE_NAME}=${loginCookie}`,
      },
      body: JSON.stringify({ email, password }),
    });

    const authCookie = extractCookie(loginRes);

    const authCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
      headers: { Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}` },
    });
    const { csrfToken } = await authCsrfRes.json();

    return {
      userId,
      cookie: authCookie,
      csrfToken,
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=${authCookie}`,
        'x-csrf-token': csrfToken,
      },
    };
  }

  // ── 1. English Exact Search ─────────────────────────────────────────────────
  test('1. English exact search matches case-insensitively and returns snippets with bounding boxes', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Kashmir Shaivism Reader',
        totalPages: 2,
      },
    });
    testBookIds.push(book.id);

    const textP1 = 'The supreme reality in Shaiva monism is known as Paramashiva, the all-pervading consciousness.';
    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'NATIVE',
        rawText: textP1,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(textP1),
        confidence: 1.0,
        bboxData: [
          { text: 'The supreme reality in Shaiva monism is known as', bbox: [[50, 100], [500, 100], [500, 120], [50, 120]] },
          { text: 'Paramashiva, the all-pervading consciousness.', bbox: [[50, 130], [450, 130], [450, 150], [50, 150]] },
        ],
      },
    });

    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=paramashiva`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.pagination.totalMatches, 1);
    const match = body.results[0];
    assert.strictEqual(match.pageNumber, 1);
    assert.strictEqual(match.source, 'NATIVE');
    assert.strictEqual(match.matchType, 'EXACT');
    assert.strictEqual(match.score, 1.0);
    assert.ok(match.highlightedSnippet.includes('<mark>Paramashiva</mark>'));
    assert.strictEqual(match.lineIndex, 1);
    assert.deepStrictEqual(match.bbox, [[50, 130], [450, 130], [450, 150], [50, 150]]);
  });

  // ── 2. Hindi Exact Search ───────────────────────────────────────────────────
  test('2. Hindi exact search matches Devanagari text accurately', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Godan Study Edition',
        totalPages: 1,
      },
    });
    testBookIds.push(book.id);

    const text = 'होरी सेमर गाँव का एक सीधा-साधा किसान था। धनिया उसकी धर्मपत्नी थी।';
    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'OCR',
        rawText: text,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(text),
        confidence: 0.95,
      },
    });

    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('होरी')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.pagination.totalMatches, 1);
    const match = body.results[0];
    assert.strictEqual(match.pageNumber, 1);
    assert.strictEqual(match.source, 'OCR');
    assert.strictEqual(match.matchType, 'EXACT');
    assert.ok(match.highlightedSnippet.includes('<mark>होरी</mark>'));
  });

  // ── 3. Hindi Normalized Spelling Variants ───────────────────────────────────
  test('3. Hindi normalized search matches spelling variants (Pancham Varna & Chandrabindu)', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Hindi Linguistic Corpus',
        totalPages: 2,
      },
    });
    testBookIds.push(book.id);

    // Page 1 has classical Pancham Varna "सम्बन्ध" and Chandrabindu "गाँव"
    const textP1 = 'दो व्यक्तियों के बीच का गहरा सम्बन्ध समाज का आधार है। गाँव में सब मिलजुलकर रहते हैं।';
    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'OCR',
        rawText: textP1,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(textP1),
      },
    });

    // Query with modern Anusvara "संबंध"
    const res1 = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('संबंध')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    assert.strictEqual(body1.pagination.totalMatches, 1);
    assert.strictEqual(body1.results[0].matchType, 'NORMALIZED');

    // Query with modern Anusvara "गांव"
    const res2 = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('गांव')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.pagination.totalMatches, 1);
    assert.strictEqual(body2.results[0].matchType, 'NORMALIZED');
  });

  // ── 4. Nukta-Sensitive Minimal Pairs ─────────────────────────────────────────
  test('4. Nukta-sensitive words do not collide under default safe normalization', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Poetics and Nuance',
        totalPages: 1,
      },
    });
    testBookIds.push(book.id);

    // Book contains "जरा" (old age in Sanskrit/Hindi), but NOT "ज़रा" (a little in Urdu)
    const text = 'धनिया ने कहा कि जरा जल्दी लौट आना, खेत में पानी देना बाकी है।';
    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'OCR',
        rawText: text,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(text, { stripNuktas: false }),
      },
    });

    // Searching for "ज़रा" (with nukta) must NOT match "जरा"
    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('ज़रा')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.pagination.totalMatches, 0, 'ज़रा must not match जरा under default safe matching');
  });

  // ── 5. Complex Hindi Misspellings (Fuzzy Matching) ──────────────────────────
  test('5. Complex Hindi misspellings and typos match via Tier 3 fuzzy search', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Historical Anthology',
        totalPages: 1,
      },
    });
    testBookIds.push(book.id);

    const text = 'आज रायसाहब अमरपाल सिंह की ड्योढ़ी पर हाजिरी बजाने जाना था।';
    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'OCR',
        rawText: text,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(text),
      },
    });

    // Typo: "अमरपाल्" (with Halant) vs "अमरपाल"
    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('अमरपाल्')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.pagination.totalMatches, 1);
    assert.strictEqual(body.results[0].matchType, 'FUZZY');
    assert.strictEqual(body.results[0].matchedTerm, 'अमरपाल');

    // Multi-word typo: "रायसाहब अमरपाल्" -> matches page via multi-word fuzzy
    const resMulti = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('रायसाहब अमरपाल्')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(resMulti.status, 200);
    const bodyMulti = await resMulti.json();
    assert.strictEqual(bodyMulti.pagination.totalMatches, 1);
    assert.strictEqual(bodyMulti.results[0].matchType, 'FUZZY');
  });

  // ── 6. Sanskrit Search Limitations ──────────────────────────────────────────
  test('6. Sanskrit classical compound search and Sandhi absorption limitation', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Bhagavad Gita Bhashya',
        totalPages: 1,
      },
    });
    testBookIds.push(book.id);

    const text = 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन। योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय॥';
    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'OCR',
        rawText: text,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(text),
      },
    });

    // 1. Exact compound match succeeds
    const resCompound = await fetch(
      `${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('कर्मण्येवाधिकारस्ते')}`,
      { headers: userA.headers }
    );
    assert.strictEqual(resCompound.status, 200);
    const bodyCompound = await resCompound.json();
    assert.strictEqual(bodyCompound.pagination.totalMatches, 1);
    assert.strictEqual(bodyCompound.results[0].matchType, 'EXACT');

    // 2. Unbroken post-sandhi substring matches
    const resSub = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('फलेषु')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(resSub.status, 200);
    const bodySub = await resSub.json();
    assert.strictEqual(bodySub.pagination.totalMatches, 1);
    assert.strictEqual(bodySub.results[0].matchType, 'EXACT');

    // 3. Classical Sandhi limitation: Pre-sandhi stem "अधिकार" alone does not match
    // because "कर्मण्येव" + "अधिकारः" coalesced into "कर्मण्येवाधिकारस्ते" (अ absorbed into वा)
    const resSandhi = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent('अधिकार')}`, {
      headers: userA.headers,
    });
    assert.strictEqual(resSandhi.status, 200);
    const bodySandhi = await resSandhi.json();
    // Documents the genuine Sanskrit Sandhi compound limitation
    assert.strictEqual(bodySandhi.pagination.totalMatches, 0, 'Pre-sandhi stem अधिकार not found in coalesced वा compound');
  });

  // ── 7. Native and OCR Page Deduplication ────────────────────────────────────
  test('7. Page deduplication guarantees exactly one result per page', async () => {
    const book = await prisma.book.create({
      data: {
        userId: userA.userId,
        title: 'Deduplicated Volume',
        totalPages: 2,
      },
    });
    testBookIds.push(book.id);

    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 1,
        source: 'NATIVE',
        rawText: 'First page chapter on meditation.',
        searchTokens: ['first', 'page', 'chapter', 'meditation'],
      },
    });

    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        pageNumber: 2,
        source: 'OCR',
        rawText: 'Second page chapter on contemplation and meditation.',
        searchTokens: ['second', 'page', 'chapter', 'contemplation', 'meditation'],
      },
    });

    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=meditation`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.pagination.totalMatches, 2);
    const pageNumbers = body.results.map((r) => r.pageNumber);
    assert.deepStrictEqual(pageNumbers, [1, 2]);
    const uniquePages = new Set(pageNumbers);
    assert.strictEqual(uniquePages.size, 2, 'Must not return duplicate records for the same page');
  });

  // ── 8. Empty Queries ────────────────────────────────────────────────────────
  test('8. Empty or whitespace-only search query returns HTTP 400 QUERY_REQUIRED', async () => {
    const book = await prisma.book.create({
      data: { userId: userA.userId, title: 'Error Volume' },
    });
    testBookIds.push(book.id);

    // Empty query param
    const resEmpty = await fetch(`${baseUrl}/api/books/${book.id}/search?q=`, {
      headers: userA.headers,
    });
    assert.strictEqual(resEmpty.status, 400);
    const dataEmpty = await resEmpty.json();
    assert.strictEqual(dataEmpty.error.code, 'QUERY_REQUIRED');

    // Whitespace only
    const resSpaces = await fetch(`${baseUrl}/api/books/${book.id}/search?q=%20%20%20`, {
      headers: userA.headers,
    });
    assert.strictEqual(resSpaces.status, 400);
    const dataSpaces = await resSpaces.json();
    assert.strictEqual(dataSpaces.error.code, 'QUERY_REQUIRED');
  });

  // ── 9. Invalid Queries (Too Long) ───────────────────────────────────────────
  test('9. Query exceeding 200 characters returns HTTP 400 QUERY_TOO_LONG', async () => {
    const book = await prisma.book.create({
      data: { userId: userA.userId, title: 'Limit Volume' },
    });
    testBookIds.push(book.id);

    const longQuery = 'a'.repeat(201);
    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${longQuery}`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error.code, 'QUERY_TOO_LONG');
  });

  // ── 10. Pagination ──────────────────────────────────────────────────────────
  test('10. Pagination limits results and computes navigation metadata correctly', async () => {
    const book = await prisma.book.create({
      data: { userId: userA.userId, title: 'Multipage Volume', totalPages: 5 },
    });
    testBookIds.push(book.id);

    // Create 3 pages with matching text
    for (let p = 1; p <= 3; p++) {
      await prisma.bookPageOcr.create({
        data: {
          userId: userA.userId,
          bookId: book.id,
          pageNumber: p,
          source: 'NATIVE',
          rawText: `Page ${p} has universal resonance.`,
          searchTokens: ['page', 'universal', 'resonance'],
        },
      });
    }

    // Page 1 with limit 2
    const resP1 = await fetch(`${baseUrl}/api/books/${book.id}/search?q=resonance&page=1&limit=2`, {
      headers: userA.headers,
    });
    assert.strictEqual(resP1.status, 200);
    const bodyP1 = await resP1.json();
    assert.strictEqual(bodyP1.pagination.totalMatches, 3);
    assert.strictEqual(bodyP1.pagination.totalPages, 2);
    assert.strictEqual(bodyP1.pagination.page, 1);
    assert.strictEqual(bodyP1.pagination.hasNextPage, true);
    assert.strictEqual(bodyP1.pagination.hasPrevPage, false);
    assert.strictEqual(bodyP1.results.length, 2);
    assert.strictEqual(bodyP1.results[0].pageNumber, 1);
    assert.strictEqual(bodyP1.results[1].pageNumber, 2);

    // Page 2 with limit 2
    const resP2 = await fetch(`${baseUrl}/api/books/${book.id}/search?q=resonance&page=2&limit=2`, {
      headers: userA.headers,
    });
    assert.strictEqual(resP2.status, 200);
    const bodyP2 = await resP2.json();
    assert.strictEqual(bodyP2.pagination.page, 2);
    assert.strictEqual(bodyP2.pagination.hasNextPage, false);
    assert.strictEqual(bodyP2.pagination.hasPrevPage, true);
    assert.strictEqual(bodyP2.results.length, 1);
    assert.strictEqual(bodyP2.results[0].pageNumber, 3);
  });

  // ── 11. Cross-User Access Rejection ─────────────────────────────────────────
  test('11. User B cannot search User A volume (returns 404 BOOK_NOT_FOUND)', async () => {
    const bookA = await prisma.book.create({
      data: { userId: userA.userId, title: 'User A Private Treatise' },
    });
    testBookIds.push(bookA.id);

    await prisma.bookPageOcr.create({
      data: {
        userId: userA.userId,
        bookId: bookA.id,
        pageNumber: 1,
        source: 'NATIVE',
        rawText: 'Confidential illumination notes.',
        searchTokens: ['confidential', 'illumination', 'notes'],
      },
    });

    // User B attempts to search User A's book
    const crossRes = await fetch(`${baseUrl}/api/books/${bookA.id}/search?q=illumination`, {
      headers: userB.headers,
    });
    assert.strictEqual(crossRes.status, 404);
    const data = await crossRes.json();
    assert.strictEqual(data.error.code, 'BOOK_NOT_FOUND');
  });

  // ── 12. Large-Book Search Performance ───────────────────────────────────────
  test('12. Large book (50 pages) search executes efficiently in < 50ms', async () => {
    const book = await prisma.book.create({
      data: { userId: userA.userId, title: 'Fifty Page Treatise', totalPages: 50 },
    });
    testBookIds.push(book.id);

    const pagesData = [];
    for (let p = 1; p <= 50; p++) {
      const isTarget = p === 42;
      const text = isTarget
        ? 'On page 42 we encounter the quintessential enlightenment revelation.'
        : `Page ${p} discussion of secondary scholastic commentary and philosophical terminology.`;
      pagesData.push({
        userId: userA.userId,
        bookId: book.id,
        pageNumber: p,
        source: 'NATIVE',
        rawText: text,
        searchTokens: DevanagariSearchNormalizer.toSearchTokens(text),
      });
    }

    await prisma.bookPageOcr.createMany({ data: pagesData });

    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=quintessential`, {
      headers: userA.headers,
    });
    const t1 = performance.now();
    const duration = t1 - t0;

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.pagination.totalMatches, 1);
    assert.strictEqual(body.results[0].pageNumber, 42);
    assert.ok(duration < 100, `Large book search took ${duration.toFixed(1)}ms, expected < 100ms`);
  });

  // ── 13. Search During Active OCR Processing ──────────────────────────────────
  test('13. Search succeeds non-blockingly during active OCR job and warns about unindexed pages', async () => {
    const book = await prisma.book.create({
      data: { userId: userA.userId, title: 'Active Processing Volume', totalPages: 10 },
    });
    testBookIds.push(book.id);

    // Create 3 indexed pages out of 10
    for (let p = 1; p <= 3; p++) {
      await prisma.bookPageOcr.create({
        data: {
          userId: userA.userId,
          bookId: book.id,
          pageNumber: p,
          source: 'OCR',
          rawText: `Indexed page ${p} discussing epistemological validity.`,
          searchTokens: ['indexed', 'page', 'discussing', 'epistemological', 'validity'],
        },
      });
    }

    // Inject an active in-flight OCR job
    await prisma.ocrJob.create({
      data: {
        userId: userA.userId,
        bookId: book.id,
        status: 'PROCESSING',
        totalPages: 10,
        processedPages: 3,
        ocrPages: 3,
        startedAt: new Date(),
      },
    });

    // Execute search while job is active
    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=epistemological`, {
      headers: userA.headers,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.pagination.totalMatches, 3);
    assert.strictEqual(body.ocrStatus.isFullyIndexed, false);
    assert.strictEqual(body.ocrStatus.unindexedPages, 7);
    assert.ok(body.ocrStatus.activeJob !== null);
    assert.strictEqual(body.ocrStatus.activeJob.status, 'PROCESSING');
    assert.ok(body.ocrStatus.warning.includes('7 unindexed page(s)'));
  });
});
