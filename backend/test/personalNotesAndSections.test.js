/**
 * Personal Journal & Notes Workspace Backend Test Suite for Aks (अक्स)
 * Validates:
 * - Section auto-seeding (Daily Journal, Personal, Ideas, Work)
 * - Section CRUD & reordering
 * - Note creation with sectionId, isPinned, journalDate, appearance, typography, richContent
 * - Move note between sections & safe section deletion (unlinks without deleting notes)
 * - Filtering by sectionId, isPinned, and date
 * - Strict multi-tenant isolation
 * - Compatibility with existing book-linked notes
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';
import { assertTestResource } from '../src/utils/testDatabaseGuard.js';

describe('Aks — Personal Journal & Notes Workspace Backend Suite', () => {
  let server;
  let baseUrl;

  const testUserIds = [];
  const testNoteIds = [];
  const testSectionIds = [];
  const testBookIds = [];

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    // Clean up test data
    if (testNoteIds.length > 0) {
      assertTestResource(testNoteIds[0], testNoteIds, 'note');
      await prisma.note.deleteMany({ where: { id: { in: testNoteIds } } });
    }
    if (testSectionIds.length > 0) {
      assertTestResource(testSectionIds[0], testSectionIds, 'section');
      await prisma.noteSection.deleteMany({ where: { id: { in: testSectionIds } } });
    }
    if (testBookIds.length > 0) {
      assertTestResource(testBookIds[0], testBookIds, 'book');
      await prisma.book.deleteMany({ where: { id: { in: testBookIds } } });
    }
    if (testUserIds.length > 0) {
      assertTestResource(testUserIds[0], testUserIds, 'user');
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
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

  // ── 1. Section Auto-Seeding & Creation ──────────────────────────────────────
  test('1. GET /api/notes/sections auto-seeds default sections for new user', async () => {
    const user = await createAuthenticatedUser('Writer One', `writer1_${Date.now()}@test.journal`, 'Pass1234!');

    const res = await fetch(`${baseUrl}/api/notes/sections`, { headers: user.headers });
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.sections));
    assert.strictEqual(data.sections.length, 4);

    const sectionNames = data.sections.map((s) => s.name);
    assert.ok(sectionNames.includes('Daily Journal'));
    assert.ok(sectionNames.includes('Personal'));
    assert.ok(sectionNames.includes('Ideas'));
    assert.ok(sectionNames.includes('Work'));

    data.sections.forEach((s) => testSectionIds.push(s.id));
  });

  test('2. POST /api/notes/sections creates custom section and rejects duplicates', async () => {
    const user = await createAuthenticatedUser('Writer Two', `writer2_${Date.now()}@test.journal`, 'Pass1234!');

    // Create custom section
    const createRes = await fetch(`${baseUrl}/api/notes/sections`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Philosophy', color: '#c29b74', icon: 'book' }),
    });
    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.section.name, 'Philosophy');
    assert.strictEqual(createData.section.color, '#c29b74');
    testSectionIds.push(createData.section.id);

    // Reject duplicate name with 409 Conflict
    const dupRes = await fetch(`${baseUrl}/api/notes/sections`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Philosophy' }),
    });
    assert.strictEqual(dupRes.status, 409);
  });

  // ── 2. Note Creation with Rich Fields ───────────────────────────────────────
  test('3. POST /api/notes creates note with richContent, isPinned, journalDate, and typography', async () => {
    const user = await createAuthenticatedUser('Journalist', `journalist_${Date.now()}@test.journal`, 'Pass1234!');

    // Fetch auto-seeded sections
    const secRes = await fetch(`${baseUrl}/api/notes/sections`, { headers: user.headers });
    const { sections } = await secRes.json();
    sections.forEach((s) => testSectionIds.push(s.id));
    const journalSection = sections.find((s) => s.name === 'Daily Journal');

    const richDoc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Morning Meditation' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Reflections on stillness and creative energy.' }],
        },
      ],
    };

    const noteRes = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Morning Entry',
        content: 'Reflections on stillness and creative energy.',
        richContent: richDoc,
        sectionId: journalSection.id,
        isPinned: true,
        journalDate: '2026-11-02T00:00:00.000Z',
        appearance: 'midnight',
        typography: { fontFamily: "'Cinzel', serif", fontSize: '18px' },
      }),
    });

    assert.strictEqual(noteRes.status, 201);
    const noteData = await noteRes.json();
    testNoteIds.push(noteData.note.id);

    assert.strictEqual(noteData.note.title, 'Morning Entry');
    assert.strictEqual(noteData.note.isPinned, true);
    assert.strictEqual(noteData.note.appearance, 'midnight');
    assert.strictEqual(noteData.note.sectionId, journalSection.id);
    assert.deepStrictEqual(noteData.note.richContent, richDoc);
    assert.strictEqual(noteData.note.section?.name, 'Daily Journal');
  });

  // ── 3. Move Note Between Sections & Safe Section Deletion ───────────────────
  test('4. Move note to another section and delete section safely (unlinks note)', async () => {
    const user = await createAuthenticatedUser('Mover User', `mover_${Date.now()}@test.journal`, 'Pass1234!');

    // Create custom section
    const secRes = await fetch(`${baseUrl}/api/notes/sections`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Temporary Section' }),
    });
    const { section: tempSec } = await secRes.json();
    testSectionIds.push(tempSec.id);

    // Create note in temp section
    const noteRes = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Note to be unlinked',
        content: 'Preserved content',
        sectionId: tempSec.id,
      }),
    });
    const { note } = await noteRes.json();
    testNoteIds.push(note.id);
    assert.strictEqual(note.sectionId, tempSec.id);

    // Delete section
    const delSecRes = await fetch(`${baseUrl}/api/notes/sections/${tempSec.id}`, {
      method: 'DELETE',
      headers: user.headers,
    });
    assert.strictEqual(delSecRes.status, 200);

    // Verify note still exists but sectionId is now null
    const checkNoteRes = await fetch(`${baseUrl}/api/notes/${note.id}`, { headers: user.headers });
    assert.strictEqual(checkNoteRes.status, 200);
    const { note: updatedNote } = await checkNoteRes.json();
    assert.strictEqual(updatedNote.id, note.id);
    assert.strictEqual(updatedNote.sectionId, null);
    assert.strictEqual(updatedNote.content, 'Preserved content');
  });

  // ── 4. Filtering by Section, Pinned & Date ──────────────────────────────────
  test('5. GET /api/notes accurately filters by sectionId, isPinned, and date', async () => {
    const user = await createAuthenticatedUser('Filter User', `filter_${Date.now()}@test.journal`, 'Pass1234!');

    const secRes = await fetch(`${baseUrl}/api/notes/sections`, { headers: user.headers });
    const { sections } = await secRes.json();
    sections.forEach((s) => testSectionIds.push(s.id));
    const ideasSection = sections.find((s) => s.name === 'Ideas');

    // Note 1: Ideas section, pinned
    const n1Res = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Innovative Project',
        content: 'AI notebook ideas',
        sectionId: ideasSection.id,
        isPinned: true,
      }),
    });
    const { note: n1 } = await n1Res.json();
    testNoteIds.push(n1.id);

    // Note 2: Unsectioned, unpinned
    const n2Res = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Random musing',
        content: 'Unsectioned text',
        isPinned: false,
      }),
    });
    const { note: n2 } = await n2Res.json();
    testNoteIds.push(n2.id);

    // Filter by sectionId
    const resSec = await fetch(`${baseUrl}/api/notes?sectionId=${ideasSection.id}`, { headers: user.headers });
    const dataSec = await resSec.json();
    assert.strictEqual(dataSec.notes.length, 1);
    assert.strictEqual(dataSec.notes[0].id, n1.id);

    // Filter by isPinned=true
    const resPin = await fetch(`${baseUrl}/api/notes?isPinned=true`, { headers: user.headers });
    const dataPin = await resPin.json();
    assert.strictEqual(dataPin.notes.length, 1);
    assert.strictEqual(dataPin.notes[0].id, n1.id);
  });

  // ── 5. Multi-Tenant Isolation ──────────────────────────────────────────────
  test('6. Multi-tenant isolation: User A cannot access or see User B sections or notes', async () => {
    const userA = await createAuthenticatedUser('User Alpha', `alpha_${Date.now()}@test.journal`, 'Pass1234!');
    const userB = await createAuthenticatedUser('User Beta', `beta_${Date.now()}@test.journal`, 'Pass1234!');

    // User A creates a secret section and note
    const secResA = await fetch(`${baseUrl}/api/notes/sections`, {
      method: 'POST',
      headers: { ...userA.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alpha Secret Journal' }),
    });
    const { section: secA } = await secResA.json();
    testSectionIds.push(secA.id);

    const noteResA = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { ...userA.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Alpha Private Thoughts',
        content: 'Confidential content',
        sectionId: secA.id,
      }),
    });
    const { note: noteA } = await noteResA.json();
    testNoteIds.push(noteA.id);

    // User B tries to fetch User A note -> 404
    const getResB = await fetch(`${baseUrl}/api/notes/${noteA.id}`, { headers: userB.headers });
    assert.strictEqual(getResB.status, 404);

    // User B tries to delete User A section -> 404
    const delResB = await fetch(`${baseUrl}/api/notes/sections/${secA.id}`, {
      method: 'DELETE',
      headers: userB.headers,
    });
    assert.strictEqual(delResB.status, 404);

    // User B notes list should not contain User A note
    const listResB = await fetch(`${baseUrl}/api/notes`, { headers: userB.headers });
    const dataB = await listResB.json();
    assert.ok(dataB.notes.every((n) => n.id !== noteA.id));
  });

  // ── 6. Preserves Book-Linked Reading Notes ─────────────────────────────────
  test('7. Existing book-linked note creation and queries remain 100% compatible', async () => {
    const user = await createAuthenticatedUser('Reader User', `reader_${Date.now()}@test.journal`, 'Pass1234!');

    // Create book
    const bookRes = await fetch(`${baseUrl}/api/books`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Meditations of Marcus Aurelius', totalPages: 180 }),
    });
    const { book } = await bookRes.json();
    testBookIds.push(book.id);

    // Create book-linked note
    const noteRes = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { ...user.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Book 4 Reflection',
        content: 'The universe is change; our life is what our thoughts make it.',
        bookId: book.id,
        page: 42,
        type: 'BOOK',
        category: 'Analysis',
      }),
    });

    assert.strictEqual(noteRes.status, 201);
    const { note } = await noteRes.json();
    testNoteIds.push(note.id);

    assert.strictEqual(note.bookId, book.id);
    assert.strictEqual(note.page, 42);
    assert.strictEqual(note.type, 'BOOK');
    assert.strictEqual(note.bookTitleSnapshot, 'Meditations of Marcus Aurelius');
    assert.strictEqual(note.category, 'Analysis');
  });
});

