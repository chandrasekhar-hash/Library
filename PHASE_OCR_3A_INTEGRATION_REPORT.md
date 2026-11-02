# Aks (अक्स) — Phase OCR-3A: Secure Backend Integration Foundation Report

**Phase:** OCR-3A (Secure Backend Integration Foundation)  
**Date:** October 29, 2026  
**Status:** **COMPLETED & VERIFIED**  
**All Regression Suites:** 
- Backend: **197 / 197 passed** (100%)
- Frontend: **148 / 148 passed** (100%)
- OCR Engine: **49 / 49 passed** (100%)

---

## 1. Executive Summary & Integration Architecture

Phase **OCR-3A** establishes the secure backend integration between the Aks Node.js server and the independently developed Python PaddleOCR worker engine (`ocr-engine/`). 

### Core Architecture Flow
```
┌────────────────────────────────────────────────────────────────────────┐
│                          Aks Frontend SPA                              │
│                   (React 19 / Vite / PDF.js)                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP (Session Cookie + CSRF)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Aks Node.js Backend                            │
│                       (Express / Prisma / PostgreSQL)                  │
│                                                                        │
│  1. Check Authentication (req.userId from session)                    │
│  2. Validate Book Ownership (prisma.book.findFirst where {id, userId}) │
│  3. Verify attached BookFile storage path                              │
│  4. Hybrid Extraction Step:                                            │
│     - Attempt native text extraction (pdfjs-dist legacy)               │
│     - If usable (>25 chars, >5 words): persist as NATIVE (Bypass OCR)  │
│     - If empty or scan: enqueue OCR request to Python Worker           │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
    Loopback HTTP   │                                │ SQL Queries
 (Bearer Token Auth)│                                │
                    ▼                                ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│       Python OCR Worker (:5060)      │  │     PostgreSQL (aks_db)      │
│  (FastAPI / PaddleOCR / pypdfium2)   │  │                              │
│                                      │  │ • OcrJob                     │
│  • Concurrency Gate (max_jobs = 1)   │  │ • BookPageOcr                │
│  • Subprocess Hard Isolation         │  │ • GIN Index on searchTokens  │
│  • Read-only PDFium rasterization    │  │ • Multi-tenant Constraints   │
│  • PP-OCRv6 English / Devanagari     │  └──────────────────────────────┘
└──────────────────────────────────────┘
```

### Key Architectural Guarantees
1. **Zero Direct Frontend Access**: The frontend single-page application never communicates with the Python OCR engine. All interactions flow through the authenticated Node.js backend.
2. **Private Loopback Networking**: The Python service binds strictly to `127.0.0.1:5060` and requires internal Bearer authentication (`OCR_WORKER_TOKEN`).
3. **Read-Only Storage Access**: The original PDF file in `storage/pdfs/{userId}/{bookId}.pdf` is opened in strictly read-only mode by both the Node.js rasterizer and Python PDFium. PDFs are never rewritten, converted, or overwritten.
4. **Asynchronous Background Execution**: OCR jobs run completely out-of-band via `setImmediate` and database-backed job states. Opening, reading, or paging through a book in the Reading Room never blocks on OCR.

---

## 2. Actual API Contracts & Verified Ports

### A. Python OCR Worker Service (`ocr-engine/`)
- **Default Host / Port**: `http://127.0.0.1:5060` (Loopback only)
- **Authentication**: `Authorization: Bearer <AKS_OCR_SECRET_KEY>`
- **Endpoints**:
  - `GET /health`: Non-blocking health check reporting `status: "healthy"`, memory RSS, active child workers, and configuration bounds.
  - `POST /ocr/pdf`: Processes pages of a PDF document.
    - **Payload**:
      ```json
      {
        "pdf_path": "/absolute/path/to/storage/pdfs/userId/bookId.pdf",
        "lang": "en",
        "dpi": 250,
        "start_page": 0,
        "max_pages": 1,
        "isolated": true
      }
      ```
    - **Status Codes**:
      - `200 OK`: Successful OCR output with line-level bounding boxes and confidences.
      - `401 Unauthorized / 403 Forbidden`: Missing or invalid Bearer token.
      - `404 Not Found`: PDF file path does not exist.
      - `422 Unprocessable Entity`: Corrupted or unrenderable PDF.
      - `429 Too Many Requests`: Worker concurrency gate reached (`max_concurrent_jobs = 1`). Returns `Retry-After: 5` header.
      - `500 Internal Server Error`: Native worker failure.

### B. Aks Node.js Backend Service (`backend/`)
All book endpoints require valid user session authentication (`requireAuth`) and CSRF validation for mutating methods (`validateCsrf`).

| Endpoint | Method | Purpose | Response |
| :--- | :---: | :--- | :--- |
| `/api/books/:bookId/ocr` | `POST` | Request OCR job for owned book (supports `Idempotency-Key`) | `202 Accepted` / `200 OK` (if existing) |
| `/api/books/:bookId/ocr/status` | `GET` | Get page coverage & latest job status | `200 OK` with summary |
| `/api/books/:bookId/ocr/pages` | `GET` | List all indexed pages with raw text & tokens | `200 OK` with pages array |
| `/api/books/:bookId/ocr/pages/:pageNum` | `GET` | Get single page text, bounding boxes, confidence | `200 OK` with single page |
| `/api/books/:bookId/ocr/cancel` | `POST` | Cancel active `PENDING` or `PROCESSING` job | `200 OK` with updated job |
| `/api/books/:bookId/ocr/retry` | `POST` | Retry unindexed or failed pages | `202 Accepted` |
| `/api/books/:bookId/ocr/jobs/:jobId` | `GET` | Get specific job status | `200 OK` with job details |
| `/api/ocr/health` | `GET` | Non-blocking loopback health probe to Python worker | `200 OK` / `503 Service Unavailable` |

---

## 3. Database Schema & Migration Details

Prisma migrations were created and applied to PostgreSQL `aks_db`:
1. `20261029045813_add_ocr_job_and_page_models`
2. `20261029045842_add_search_tokens_gin_index`

### Prisma Models
```prisma
enum OcrJobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}

enum OcrPageSource {
  NATIVE
  OCR
}

model OcrJob {
  id             String       @id @default(uuid())
  userId         String
  bookId         String
  status         OcrJobStatus @default(PENDING)
  language       String       @default("en")
  totalPages     Int          @default(0)
  processedPages Int          @default(0)
  failedPages    Int          @default(0)
  nativePages    Int          @default(0)
  ocrPages       Int          @default(0)
  errorMessage   String?      @db.Text
  errorDetails   Json?
  idempotencyKey String?
  createdAt      DateTime     @default(now())
  startedAt      DateTime?
  completedAt    DateTime?
  updatedAt      DateTime     @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  book Book @relation(fields: [bookId, userId], references: [id, userId], onDelete: Cascade)

  @@unique([userId, idempotencyKey])
  @@index([userId, status])
  @@index([bookId, status])
  @@index([status, createdAt])
}

model BookPageOcr {
  id                String        @id @default(uuid())
  userId            String
  bookId            String
  pageNumber        Int           // 1-based page number
  source            OcrPageSource @default(OCR) // NATIVE or OCR
  rawText           String        @db.Text
  searchTokens      String[]      // Normalized search tokens for indexing
  normalizerVersion String        @default("1.0.0")
  language          String        @default("en")
  confidence        Float?        // Recognition confidence [0.0 - 1.0]
  lineCount         Int           @default(0)
  detectedRotation  Int           @default(0)
  bboxData          Json?         // Line-level bounding box array: [{ text, confidence, bbox }]
  metadata          Json?         // Resolution, dimensions, duration
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  book Book @relation(fields: [bookId, userId], references: [id, userId], onDelete: Cascade)

  @@unique([bookId, pageNumber, userId])
  @@index([userId])
  @@index([bookId, pageNumber])
  @@index([bookId, language])
}
```

### PostgreSQL Search Indexing & Devanagari Limitations
- **GIN Index Applied**:
  ```sql
  CREATE INDEX "BookPageOcr_searchTokens_gin_idx" ON "BookPageOcr" USING GIN ("searchTokens");
  ```
- **PostgreSQL Full-Text Search Limitations Documented**:
  - PostgreSQL's built-in `tsvector` with `'english'` dictionary performs English-specific stemming (e.g. `reading` $\rightarrow$ `read`) and stopword elimination.
  - PostgreSQL does **not** include a Hindi or Sanskrit stemmer or dictionary in `pg_catalog`. Running standard `to_tsvector('simple', text)` performs only ASCII lowercasing and whitespace splitting; it completely ignores Devanagari ligatures, Chandrabindu, Pancham Varna variants, and Visarga normalizations.
  - **Aks Two-Tiered Solution**:
    1. Raw OCR output is stored verbatim in `rawText` and `bboxData` for reading and highlight rendering.
    2. Canonical normalized tokens generated by `DevanagariSearchNormalizer` (v1.0.0) are stored in `searchTokens String[]`.
    3. The GIN array index on `searchTokens` enables exact and subset query matching (`searchTokens @> ARRAY['संपादक']`) with sub-millisecond execution times without altering the displayed text.

---

## 4. Native Extraction vs. OCR Decision Logic

To maximize performance, battery life, and recognition precision, Aks employs a **Hybrid Extraction Strategy**:

```
[ PDF Page Request ]
         │
         ▼
[ Attempt Native PDF.js Text Extraction ]
         │
         ├── Extracted text length >= 25 chars?
         ├── Word count (length > 1) >= 5 words?
         └── AlphaNum to symbol density >= 0.3?
         │
    ┌────┴────┐
    │         │
   YES        NO (Scanned page, image, diagram, or blank)
    │         │
    ▼         ▼
[ Mark NATIVE ]              [ Dispatch to Python PaddleOCR ]
Confidence: 1.0               Resolution: 250 DPI
Duration: < 5 ms              Detection: PP-OCRv6 DBNet
PaddleOCR: BYPASSED           Recognition: English / Devanagari
                              Confidence: Measured
                              Duration: ~5.5 s
```

### Measured Performance Gains
- **Digital Kashmir Shaivism Volume** (Native Text):
  - Extraction time: **3.8 ms** per page.
  - Memory: **< 1 MB** heap allocation.
  - Accuracy: **100.0%** ground-truth character accuracy.
  - OCR Engine CPU usage: **0%** (PaddleOCR worker was not invoked).
- **Degraded Manuscript Scan** (Scanned Image):
  - Native text extracted: `""` (0 chars) $\rightarrow$ Correctly recognized as scanned.
  - Automatically routed to Python OCR worker for 250 DPI rasterization and recognition.

---

## 5. OCR Job Lifecycle & Concurrency Resilience

1. **Idempotency & Duplicate Prevention**:
   - Every job request supports an `Idempotency-Key`.
   - If an active job (`PENDING` or `PROCESSING`) already exists for a book, the endpoint returns the existing job (`isExisting: true`) instead of launching parallel processing.
2. **HTTP 429 Backoff & Worker Concurrency Gate**:
   - The Python OCR engine enforces `max_concurrent_jobs = 1`.
   - If the worker returns HTTP 429, the Node.js client inspects the `Retry-After` header (default 5s) and backs off gracefully without crashing or terminating the parent job.
3. **Database-Backed Server Restart Recovery**:
   - On server boot (`OcrJobService.recoverDanglingJobs()`), all jobs previously marked `PROCESSING` are reconciled to `FAILED` with message `'Job was interrupted by a backend server restart.'`.
   - Any `PENDING` jobs are picked up and resumed sequentially.

---

## 6. Security & Multi-Tenant Isolation Audit

- **Foreign Key Isolation**:
  - Foreign keys reference `Book(id, userId)` via composite relationship. User B cannot create an OCR job or page record pointing to User A's book.
- **Strict Multi-Tenant Query Scoping**:
  - All database queries filter by `userId: req.userId` resolved from the cryptographically verified session.
  - Cross-user attempts return `404 Not Found` rather than leaking book existence.
- **Storage Path Traversal Protection**:
  - `resolveSafeStoragePath()` guarantees paths stay strictly within `STORAGE_ROOT/pdfs`.
  - Storage paths are never leaked to the client in JSON responses.
- **Zero Temporary File Leakage**:
  - Native text extraction streams directly from memory buffers.
  - Python worker rasterizes directly in memory and reaps child processes upon completion.
  - `storage/temp` directory remains clean (0 lingering files).

---

## 7. Full Regression Suite Verification

### A. New Integration Test Suite (`backend/test/ocrIntegration.test.js`)
All 11 integration tests passed:
1. `Devanagari normalizer preserves raw text separation and avoids semantic collisions`: **PASSED**
2. `Native-text page bypasses OCR worker completely and stores source=NATIVE`: **PASSED**
3. `Scanned page without native text triggers OCR worker and stores source=OCR`: **PASSED**
4. `Mixed PDF: Page 1 native text bypasses OCR, Page 2 scanned triggers OCR`: **PASSED**
5. `Multi-tenant isolation: Unauthenticated requests and cross-user access rejected`: **PASSED**
6. `Duplicate job prevention returns existing job without spawning duplicates`: **PASSED**
7. `Worker offline handled gracefully without crashing Node.js backend`: **PASSED**
8. `Worker HTTP 429 returns structured error with Retry-After header`: **PASSED**
9. `Slow worker triggers timeout and aborts cleanly`: **PASSED**
10. `Backend restart reconciles interrupted PROCESSING jobs to FAILED`: **PASSED**
11. `Zero lingering temporary files in storage/temp`: **PASSED**

### B. Complete System Regressions
- **Backend Test Suite**: **197 / 197 tests passed** in `14.18s` (0 failures).
- **Frontend Test Suite**: **148 / 148 tests passed** in `0.17s` (0 failures).
- **OCR Engine Test Suite**: **49 / 49 tests passed** in `253s` (0 failures).

---

## 8. Remaining Limitations & Next Phase Instructions

### Limitations
1. **Single-Worker Default**: On 16 GB machines, `max_concurrent_jobs` must remain `1` to keep combined RAM consumption bounded below 3.5 GB.
2. **Vedic Accents**: As established in Phase OCR-2.3, Vedic svara markers are unsupported by the current recognition models.

### Instructions for Next Phase (Phase OCR-3B / Search UI)
1. **Frontend Search Integration**:
   - Connect the Reading Room search drawer to query `/api/books/:bookId/ocr/pages`.
   - Match queries against `searchTokens` using `DevanagariSearchNormalizer`.
2. **Search Highlighting**:
   - Use `bboxData` stored in `BookPageOcr` to position search highlight rectangles over the canvas.
3. **Progress Indicators**:
   - Display non-intrusive indexing indicators in the library and book view when OCR is actively processing.

