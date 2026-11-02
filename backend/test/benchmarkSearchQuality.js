/**
 * Multilingual Search Quality Benchmark for Aks (अक्स) Phase OCR-3B
 *
 * Evaluates:
 * - Precision, Recall, False-Positive Rate across:
 *   - Tier 1: Exact matches (English, Hindi, Sanskrit)
 *   - Tier 2: Normalized spelling variants (Chandrabindu, Pancham Varna)
 *   - Tier 2: Nukta preservation & false-positive collision audit (राज/राज़, जरा/ज़रा)
 *   - Tier 3: Fuzzy typo-tolerant queries (edit distance 1 and 2)
 *   - Negative controls (non-matching queries)
 * - Query Latency (p50, p95, max)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { storagePaths } from '../src/config/storage.js';
import { DevanagariSearchNormalizer } from '../src/utils/devanagariNormalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBenchmark() {
  console.log('─────────────────────────────────────────────────────────────');
  console.log('  Aks (अक्स) Phase OCR-3B: Search Quality & Latency Benchmark');
  console.log('─────────────────────────────────────────────────────────────\n');

  // 1. Boot test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  // 2. Setup test user
  const email = `benchmark_${Date.now()}@aks.library`;
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const anonCookie = csrfRes.headers.get('set-cookie').match(/aks\.sid=([^;]+)/)[1];
  const { csrfToken: regCsrf } = await csrfRes.json();

  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': regCsrf,
      Cookie: `aks.sid=${anonCookie}`,
    },
    body: JSON.stringify({ name: 'Search Benchmarker', email, password: 'SecurePassword123!' }),
  });
  const { user } = await regRes.json();

  const loginCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const { csrfToken: loginCsrf } = await loginCsrfRes.json();
  const loginCookie = loginCsrfRes.headers.get('set-cookie').match(/aks\.sid=([^;]+)/)[1];

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': loginCsrf,
      Cookie: `aks.sid=${loginCookie}`,
    },
    body: JSON.stringify({ email, password: 'SecurePassword123!' }),
  });
  const authCookie = loginRes.headers.get('set-cookie').match(/aks\.sid=([^;]+)/)[1];

  const authCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: `aks.sid=${authCookie}` },
  });
  const { csrfToken } = await authCsrfRes.json();

  const headers = {
    Cookie: `aks.sid=${authCookie}`,
    'x-csrf-token': csrfToken,
  };

  // 3. Create test volume with representative ground truth samples
  const book = await prisma.book.create({
    data: {
      userId: user.id,
      title: 'Multilingual Benchmark Corpus',
      totalPages: 3,
    },
  });

  // Page 1: Clean English
  const englishText = `In Trika Shaivism and Indian philosophy, the individual soul is regarded as a microcosmic reflection of supreme consciousness. The internal contemplation of reality leads to aesthetic rapture and intellectual liberation.`;
  await prisma.bookPageOcr.create({
    data: {
      userId: user.id,
      bookId: book.id,
      pageNumber: 1,
      source: 'NATIVE',
      rawText: englishText,
      searchTokens: DevanagariSearchNormalizer.toSearchTokens(englishText),
      confidence: 1.0,
      lineCount: 2,
    },
  });

  // Page 2: Hindi Prose (Premchand / Godan sample with classical spellings and minimal pairs)
  const hindiText = `होरी सेमर गाँव का एक सीधा-साधा किसान था। धनिया ने चौखट पर खड़े होकर कहा, 'जरा जल्दी लौट आना, खेत में पानी लगाना बाकी है।' रायसाहब अमरपाल सिंह इलाके के जमींदार थे। इस सम्बंध में सबका कल्याण है।`;
  await prisma.bookPageOcr.create({
    data: {
      userId: user.id,
      bookId: book.id,
      pageNumber: 2,
      source: 'OCR',
      rawText: hindiText,
      searchTokens: DevanagariSearchNormalizer.toSearchTokens(hindiText),
      confidence: 0.94,
      lineCount: 4,
    },
  });

  // Page 3: Sanskrit Classical (Gita / Shankara Bhashya with Pancham Varna)
  const sanskritText = `कर्मण्येवाधिकारस्ते मा फलेषु कदाचन। योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय। शाङ्करभाष्यम्: सङ्गोऽस्तु मा अकर्मणि।`;
  await prisma.bookPageOcr.create({
    data: {
      userId: user.id,
      bookId: book.id,
      pageNumber: 3,
      source: 'OCR',
      rawText: sanskritText,
      searchTokens: DevanagariSearchNormalizer.toSearchTokens(sanskritText),
      confidence: 0.88,
      lineCount: 3,
    },
  });

  // 4. Test Queries Matrix
  const queryCases = [
    // TIER 1: Exact matches
    { query: 'microcosmic', expectedPages: [1], tier: 'EXACT', desc: 'English Exact (Single Word)' },
    { query: 'aesthetic rapture', expectedPages: [1], tier: 'EXACT', desc: 'English Exact (Multi-Word Phrase)' },
    { query: 'होरी', expectedPages: [2], tier: 'EXACT', desc: 'Hindi Exact (Character Name)' },
    { query: 'अमरपाल', expectedPages: [2], tier: 'EXACT', desc: 'Hindi Exact (Compound Name)' },
    { query: 'कर्मण्येवाधिकारस्ते', expectedPages: [3], tier: 'EXACT', desc: 'Sanskrit Exact (Compound Verse)' },

    // TIER 2: Normalized matches (Spelling variants & Anusvara canonicalization)
    { query: 'गांव', expectedPages: [2], tier: 'NORMALIZED', desc: 'Hindi Normalized (Chandrabindu गाँव -> गांव)' },
    { query: 'संबंध', expectedPages: [2], tier: 'NORMALIZED', desc: 'Hindi Normalized (Pancham Varna सम्बंध -> संबंध)' },
    { query: 'संगं', expectedPages: [3], tier: 'NORMALIZED', desc: 'Sanskrit Normalized (सङ्गं -> संगं)' },
    { query: 'धनंजय', expectedPages: [3], tier: 'NORMALIZED', desc: 'Sanskrit Normalized (धनञ्जय -> धनंजय)' },
    { query: 'शांकरभाष्यम्', expectedPages: [3], tier: 'NORMALIZED', desc: 'Sanskrit Normalized (शाङ्करभाष्यम् -> शांकरभाष्यम्)' },

    // TIER 2/SAFETY: Nukta minimal pair negative control (Must NOT match)
    { query: 'ज़रा', expectedPages: [], tier: 'NEGATIVE_NUKTA', desc: 'Nukta Minimal Pair (Query ज़रा [secret/urdu] vs जरा [old-age/hindi])' },
    { query: 'राज़', expectedPages: [], tier: 'NEGATIVE_NUKTA', desc: 'Nukta Minimal Pair (Query राज़ [secret] vs raw text without it)' },

    // TIER 3: Fuzzy matches (Typo & OCR substitution tolerance)
    { query: 'microcosmik', expectedPages: [1], tier: 'FUZZY', desc: 'English Fuzzy (1 char typo: c->k)' },
    { query: 'philosophyy', expectedPages: [1], tier: 'FUZZY', desc: 'English Fuzzy (1 extra char)' },
    { query: 'अमरपाल्', expectedPages: [2], tier: 'FUZZY', desc: 'Hindi Fuzzy (Halant typo: अमरपाल् -> अमरपाल)' },

    // NEGATIVE CONTROLS: Words not present in any page
    { query: 'aeroplane', expectedPages: [], tier: 'NEGATIVE', desc: 'English Negative (Absence)' },
    { query: 'कंप्यूटर', expectedPages: [], tier: 'NEGATIVE', desc: 'Hindi Negative (Absence)' },
    { query: 'बृहदारण्यक', expectedPages: [], tier: 'NEGATIVE', desc: 'Sanskrit Negative (Absence)' },
  ];

  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;

  const latencies = [];
  const tierResults = {
    EXACT: { count: 0, passed: 0 },
    NORMALIZED: { count: 0, passed: 0 },
    FUZZY: { count: 0, passed: 0 },
    NEGATIVE_NUKTA: { count: 0, passed: 0 },
    NEGATIVE: { count: 0, passed: 0 },
  };

  console.log('| Category | Query | Expected Pages | Actual Pages | Match Type | Latency | Status |');
  console.log('| :--- | :--- | :---: | :---: | :---: | :---: | :---: |');

  for (const tc of queryCases) {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/books/${book.id}/search?q=${encodeURIComponent(tc.query)}`, {
      headers,
    });
    const t1 = performance.now();
    const latency = Math.round(t1 - t0);
    latencies.push(latency);

    const body = await res.json();
    const actualPages = (body.results || []).map((r) => r.pageNumber);
    const topMatch = body.results?.[0];
    const actualMatchType = topMatch ? topMatch.matchType : 'NONE';

    // Verify expectations
    const isExpected =
      tc.expectedPages.length === actualPages.length &&
      tc.expectedPages.every((p) => actualPages.includes(p));

    tierResults[tc.tier].count++;
    if (isExpected) {
      tierResults[tc.tier].passed++;
    }

    if (tc.expectedPages.length > 0) {
      if (actualPages.length > 0) {
        if (isExpected) {
          truePositives++;
        } else {
          // Found wrong page or missing page
          falsePositives += actualPages.filter((p) => !tc.expectedPages.includes(p)).length;
          falseNegatives += tc.expectedPages.filter((p) => !actualPages.includes(p)).length;
        }
      } else {
        falseNegatives++;
      }
    } else {
      // Negative control: should return 0 results
      if (actualPages.length === 0) {
        trueNegatives++;
      } else {
        falsePositives += actualPages.length;
      }
    }

    const statusIcon = isExpected ? 'PASS' : 'FAIL';
    console.log(
      `| ${tc.tier} | \`${tc.query}\` | [${tc.expectedPages.join(',')}] | [${actualPages.join(',')}] | ${actualMatchType} | ${latency}ms | ${statusIcon} |`
    );
  }

  // Summary Metrics
  const precision = truePositives / (truePositives + falsePositives || 1);
  const recall = truePositives / (truePositives + falseNegatives || 1);
  const falsePositiveRate = falsePositives / (falsePositives + trueNegatives || 1);

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const maxLatency = latencies[latencies.length - 1];

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  Summary Performance & Search Quality Metrics');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`Precision:            ${(precision * 100).toFixed(2)}%`);
  console.log(`Recall:               ${(recall * 100).toFixed(2)}%`);
  console.log(`False Positive Rate:  ${(falsePositiveRate * 100).toFixed(2)}%`);
  console.log(`Median Latency (p50): ${p50} ms`);
  console.log(`95th Percentile (p95):${p95} ms`);
  console.log(`Max Latency:          ${maxLatency} ms\n`);

  console.log('Tier Breakdown:');
  for (const [tier, data] of Object.entries(tierResults)) {
    console.log(`  - ${tier.padEnd(16)}: ${data.passed} / ${data.count} passed (${((data.passed/data.count)*100).toFixed(1)}%)`);
  }

  // Cleanup
  await prisma.bookPageOcr.deleteMany({ where: { bookId: book.id } });
  await prisma.book.delete({ where: { id: book.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();

  return {
    precision,
    recall,
    falsePositiveRate,
    p50,
    p95,
    maxLatency,
    tierResults,
  };
}

runBenchmark().catch((err) => {
  console.error('[Fatal Benchmark Error]:', err);
  process.exit(1);
});
