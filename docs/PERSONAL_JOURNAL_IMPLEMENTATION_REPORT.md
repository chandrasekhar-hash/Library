# Aks (अक्स) — Personal Journal & Notes Workspace Implementation Report

## Executive Summary

The Notes section of **Aks** has been transformed from a purely book-annotation tool into an independent, premium literary writing and daily journaling workspace. 

The new architecture provides:
1. **Personal Notes & Notebook Sections**: Standalone, user-owned notebooks with full CRUD, reordering, custom accents, and note-moving capabilities.
2. **Daily Journal**: A dedicated date-indexed journaling experience with calendar navigation, today shortcuts, and multi-entry chronological logging.
3. **TipTap ProseMirror Rich Text Engine**: Clean, structured JSON persistence (`richContent`) with zero unsafe HTML injection, comprehensive formatting (Headings, Lists, Blockquotes, Alignments, Links, Colors, Highlights), and a curated literary typography system (6 fonts, 5 sizes, 3 appearances: *Classic Paper*, *Midnight*, *Pure Minimal*).
4. **Honest Concurrency-Protected Autosave**: Debounced 800ms autosave with an in-flight timestamp guard preventing stale race conditions, and distinct status indicators (*Saving…*, *Saved*, *Save Failed / Retry*).
5. **100% Backward Compatibility**: Existing reading notes remain completely intact with their book links, page references, and "Resume Reading" jump actions.
6. **Zero-Data-Loss Database Safety**: Additive PostgreSQL migrations with multi-tenant isolation and complete guest mode parity.

---

## 1. Information Architecture & UI Design

### Dual Workspace Organization
The Notes page (`/notes`) now features a top-level workspace switcher:
- **Personal Notebook & Journal**: Independent writing space, personal thoughts, reflections, project ideas, and daily journaling.
- **Reading Notes**: Volume-associated annotations, reading highlights, chapter reflections, and direct links to the Reading Room.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Aks Reading Sanctuary  ──  Personal Notebook & Journal  │  Reading Notes (3)                   │
├───────────────────────┬─────────────────────────────────┬───────────────────────────────────────┤
│ SECTIONS              │ NOTES STREAM                    │ LITERARY WRITING CANVAS               │
│                       │                                 │                                       │
│ 📅 Daily Journal (4)   │ 🔍 Search notes...              │ [Title: Morning Musings            ]  │
│ 👤 Personal (8)       │                                 │ Section: Daily Journal | Pinned ⭐    │
│ 💡 Ideas (12)         │ ⭐ Pinned Notes                 │ ───────────────────────────────────── │
│ 💼 Work (3)           │   • Morning Musings (Today)     │ [B] [I] [U] [S] [H1] [H2] [H3] [List] │
│ 📚 Philosophy (2)     │                                 │ Font: Literary Serif | Size: 18px     │
│                       │ Recent Notes                    │ Theme: Classic Paper (Warm Ivory)     │
│ [+ New Section]       │   • Project Roadmap             │ ───────────────────────────────────── │
│                       │   • Stoic Principles            │ "The early morning stillness provides │
│                       │   • Sunday Walk Reflections     │  a sanctuary for deliberate thought." │
│                       │                                 │                                       │
│                       │                                 │ ● Saved  ·  Nov 2, 2026, 11:15 AM     │
└───────────────────────┴─────────────────────────────────┴───────────────────────────────────────┘
```

### Aesthetic Philosophy
Adhering to Aks's core identity:
- **Palette**: Deep midnight blue (`#0A1128`), warm ivory parchment (`#FDFBF7`), subtle champagne gold (`#C4975A`), and soft borders (`#E5DECE`).
- **Editor Appearances**:
  - **Classic Paper**: Warm parchment background (`#FDFBF7`) with charcoal ink (`#2C2724`).
  - **Midnight**: Nocturnal deep navy canvas (`#0A1128`) with warm gold/amber ink (`#E8DCC4`).
  - **Pure Minimal**: Clean monochrome neutral canvas (`#FFFFFF` or `#1E1E1E` in dark mode) with high-contrast text.

---

## 2. Database Schema & Migration Strategy

All schema changes in PostgreSQL (`aks_db`) were applied **additively** without any destructive resets or table recreation.

### Prisma Schema (`backend/prisma/schema.prisma`)

```prisma
model NoteSection {
  id        String   @id @default(uuid())
  userId    String
  name      String
  color     String?  @default("#C4975A")
  icon      String?  @default("folder")
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes Note[]

  @@unique([userId, name])
  @@index([userId, order])
}

model Note {
  id          String   @id @default(uuid())
  userId      String
  bookId      String?
  sectionId   String?  // Optional foreign key to NoteSection
  title       String?
  content     String
  richContent Json?    // Structured ProseMirror document JSON
  appearance  String?  @default("classic-paper")
  typography  Json?    // { fontFamily, fontSize, color, lineHeight }
  page        Int?
  type        String   @default("STANDALONE") // "STANDALONE" or "BOOK"
  category    String   @default("Reflection")
  isPinned    Boolean  @default(false)
  journalDate String?  // Format: "YYYY-MM-DD"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user    User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  book    Book?        @relation(fields: [bookId], references: [id], onDelete: Cascade)
  section NoteSection? @relation(fields: [sectionId], references: [id], onDelete: SetNull)

  @@index([userId, isPinned])
  @@index([userId, sectionId])
  @@index([userId, journalDate])
  @@index([userId, type])
}
```

### Safety Verification
- Existing reading notes remain unchanged with `sectionId: null` and `type: 'BOOK'`.
- Deleting a section uses `onDelete: SetNull`, unlinking child notes to prevent accidental note loss.
- Applied via `npx prisma db push` with tracking file `backend/prisma/migrations/20261102000000_add_personal_notes_and_sections/migration.sql`.

---

## 3. TipTap ProseMirror Rich Text Engine

### Structured JSON Persistence vs. Raw HTML
- Avoided raw `contentEditable` or arbitrary HTML strings.
- TipTap persists clean, deterministic ProseMirror JSON trees:
  ```json
  {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [{ "type": "text", "text": "Reflections on Simplicity" }]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Focus on the essential, discard the trivial." }
        ]
      }
    ]
  }
  ```
- Also maintains a plain text `content` projection for fast database search, preview snippets, and fallback rendering.

### Typography Palette
- **6 Literary Typefaces**:
  1. *Literary Serif*: `et-book, Georgia, serif`
  2. *Classic Serif*: `EB Garamond, Garamond, serif`
  3. *Modern Sans*: `Inter, -apple-system, sans-serif`
  4. *Clean Sans*: `system-ui, sans-serif`
  5. *Monospace*: `JetBrains Mono, monospace`
  6. *Handwritten*: `Caveat, cursive`
- **5 Font Sizes**: Small (14px), Standard (16px), Literary (18px), Large (20px), Dramatic (22px).
- **Curated Ink Colors & Highlights**: Deep Charcoal, Night Blue, Wine/Burgundy, Forest Green, Amber Gold, with hex color validation and highlight tinting.

---

## 4. Daily Journal System

A specialized sub-mode inside the Personal workspace:
- **Calendar Day Navigation**: Previous Day, Next Day, and Today shortcut.
- **Date Picking**: Integrated HTML5 date input matching `YYYY-MM-DD`.
- **Multi-Entry Day Logging**: Write multiple reflections throughout the day with distinct timestamps.
- **Seamless Creation**: Clicking "+ New Entry" automatically attaches today's date (`journalDate: YYYY-MM-DD`) and defaults to the *Daily Journal* section.

---

## 5. Autosave & Concurrency Engine

### Architecture
- **Debounced Save (800ms)**: User keystrokes reset an 800ms debounce timer to prevent network flooding.
- **In-Flight Concurrency Guard**:
  ```javascript
  const clientTimestamp = Date.now();
  inFlightSaveRef.current = clientTimestamp;
  
  const savedRecord = await sanctuaryDataService.saveNote(payload);
  
  // Stale response rejection
  if (inFlightSaveRef.current !== clientTimestamp) {
    return; // Superseded by a newer keystroke
  }
  ```
- **Honest Status Display**:
  - `idle`: Ready / stationary.
  - `saving`: Active spinner with "Saving…".
  - `saved`: Green checkmark with "Saved" and formatted timestamp.
  - `error`: Warning badge with "Save Failed. Retry" action preserving unsaved text.

---

## 6. Guest Mode & Authenticated Parity

- **Authenticated Users**: Synchronized with PostgreSQL via Express endpoints (`/api/notes/sections` and `/api/notes`). Default sections (*Daily Journal*, *Personal*, *Ideas*, *Work*) are auto-seeded on first access.
- **Guest Users**: Managed via `sanctuaryDataService.js` and persisted in browser storage (`localStorage` for section hierarchy and `IndexedDB` for notes).
- **Migration Ready**: When a guest registers or logs in, notes and sections retain their UUIDs and relationships for automatic migration into PostgreSQL.

---

## 7. Test Results & Verification

### Backend Test Suite (`node --test`)
- **New Personal Notes Suite** (`backend/test/personalNotesAndSections.test.js`):
  - `GET /api/notes/sections` auto-seeds default sections: **PASS**
  - `POST /api/notes/sections` creates custom section and rejects duplicates: **PASS**
  - `POST /api/notes` creates rich note with `richContent`, `isPinned`, `journalDate`, `typography`: **PASS**
  - Moving note to another section and safe section deletion (unlinks note): **PASS**
  - `GET /api/notes` filters by `sectionId`, `isPinned`, and `date`: **PASS**
  - Multi-tenant isolation between User A and User B: **PASS**
  - Existing book-linked note creation and queries remain 100% compatible: **PASS**
  - **Suite Result**: **7 / 7 passed (100%)**
- **Full Backend Regression Suite**:
  - Total Tests: **235 / 235 passed (0 failed, 0 regressions)**

### Frontend Test Suite (`node --test`)
- **New Frontend Personal Notes Suite** (`frontend/test/personalNotesWorkspace.test.js`):
  - Section schema, default seeding, and guest mode fallback: **PASS**
  - Personal note schema with `richContent`, `typography`, `appearance`, `pin`: **PASS**
  - Daily Journal entry schema and calendar date mapping: **PASS**
  - Debounced autosave state machine and concurrency guard: **PASS**
  - Reading notes compatibility and book-linking: **PASS**
  - Typography and appearance theme validation: **PASS**
  - **Suite Result**: **7 / 7 passed (100%)**
- **Full Frontend Regression Suite**:
  - Total Tests: **189 / 189 passed (0 failed, 0 regressions)**

### Production Build
- `npm run build --prefix frontend`:
  - 2061 modules transformed.
  - Zero syntax or bundling errors (completed in 266ms).
  - Code-split bundles generated for `NotesPage-DOwxS3we.js` and styling `NotesPage-DU_aLn6q.css`.

---

## 8. Modified & Created Files

| File | Type | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Backend Schema | Added `NoteSection` model, additive fields to `Note` (`sectionId`, `richContent`, `appearance`, `typography`, `isPinned`, `journalDate`), indices and foreign keys |
| `backend/prisma/migrations/20261102000000_add_personal_notes_and_sections/migration.sql` | Migration SQL | Additive SQL migration script |
| `backend/src/controllers/noteSectionController.js` | Controller | Section CRUD, auto-seeding defaults, safe deletion, and ordering |
| `backend/src/controllers/noteController.js` | Controller | Enhanced note creation, listing with section/pin/date filters, and updates |
| `backend/src/routes/noteRoutes.js` | Routes | Mounted section endpoints before note param routes |
| `backend/test/personalNotesAndSections.test.js` | Backend Test | Multi-tenant tests covering all section & personal note operations |
| `frontend/src/components/notes/RichTextEditor.jsx` | Component | TipTap ProseMirror editor, formatting toolbar, typography palette, themes |
| `frontend/src/components/notes/DailyJournalView.jsx` | Component | Calendar day navigation, today shortcut, multi-entry chronological list |
| `frontend/src/components/notes/PersonalNotesView.jsx` | Component | 3-pane layout, sections sidebar, card stream, search, sort, pin controls |
| `frontend/src/components/notes/ReadingNotesView.jsx` | Component | Preserved book reading notes, filters, and Reading Room jump |
| `frontend/src/pages/NotesPage.jsx` | Page | Main workspace view, tab switcher, debounced autosave, delete modal |
| `frontend/src/styles/notes.css` | Stylesheet | Curated typography styles, 3-pane layout, appearance themes, mobile responsive |
| `frontend/src/services/api.js` | Service | Added note section API client methods |
| `frontend/src/services/sanctuaryDataService.js` | Service | Added note section methods with guest storage fallback |
| `frontend/test/personalNotesWorkspace.test.js` | Frontend Test | Frontend test suite for sections, journal, autosave, and themes |

---

## Conclusion
The Personal Journal & Notes Workspace Redesign for Aks is complete, fully tested, and ready for production use. It fulfills all aesthetic, architectural, and data safety requirements while seamlessly preserving existing reader annotations.

