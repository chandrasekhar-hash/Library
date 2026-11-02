# Aks (अक्स) — Phase OCR-4B: Library-Wide Indexing System Report

**Date**: November 2, 2026  
**Status**: Implemented & Verified (Awaiting User Approval for Production Library Backfill)  
**System**: Aks Multilingual Reading Sanctuary & Digital Archive  

---

## 1. Executive Summary

Phase OCR-4B transitions Aks from isolated single-book OCR recovery to a universal, library-wide search indexing system. The system provides:

1. **Library-Wide Discovery & Health Auditing**: Real-time inspection of all user volumes, verifying physical PDF file existence, SHA-256 integrity, actual page counts (via `pdfjs-dist`), and page-level index coverage.
2. **Unified Sequential Persistent Queue**: PostgreSQL-backed job queue running on the `OcrJob` model with a strict concurrency limit of 1 per user, preventing resource starvation or overload of the Python OCR worker.
3. **Queue Lifecycle & Controls**: Non-blocking enqueueing of all eligible unindexed and partially indexed books, safe Pause/Resume controls, automated restart recovery on boot, and retry mechanisms.
4. **Dark Literary Indexing Interface**: `LibraryIndexingDrawer.jsx` matching Aks's dark aesthetic (ebony, parchment, warm gold), featuring overview metrics, text extraction breakdown, live queue tags, filter tabs, segmented progress bars, and individual book actions.
5. **Reading Room Integration Polish**: Refactored the "Index Book" action button in `DocumentSearch.jsx` to prevent cramped dimensions and text wrapping, adding responsive mobile wrap.
6. **Pre-Flight Dry-Run Safeguard**: As required, **the actual library backfill has NOT been run against the production database**. A complete dry-run inspection was executed, and the system is standing by for user approval.

---

## 2. Library Discovery & Audit Findings (Dry-Run)

### 2.1 Authenticated User Profile
- **Account**: CS (`abhisek07abhi@gmail.com`)
- **User ID**: `e37d1e22-a6fc-4639-906d-d33d13636c18`
- **Total Registered Books**: 2
- **Eligible Volumes (Physical PDF present)**: 2
- **Missing File Volumes**: 0

### 2.2 Aggregate Library Coverage Status
```json
{
  "totalBooks": 2,
  "eligibleBooks": 2,
  "fullyIndexedBooks": 1,
  "inProgressBooks": 0,
  "partiallyIndexedBooks": 1,
  "unindexedBooks": 0,
  "failedBooks": 0,
  "missingFileBooks": 0,
  "totalPages": 468,
  "indexedPages": 211,
  "nativePages": 180,
  "ocrPages": 31,
  "blankPages": 1,
  "unindexedPages": 257,
  "failedPages": 0,
  "overallPercent": 45,
  "isPaused": false,
  "activeJobId": null,
  "pendingJobCount": 0
}
```

### 2.3 Volume Inspection Detail

#### Volume 1: *From Shiva to Schrödinger: Unravelling Cosmic Secrets with Trika Shaivism and Quantum Insights*
- **Book ID**: `2fc57cbc-d02a-4d85-bd8f-104edd8d4e63`
- **Physical File**: `storage/pdfs/e37d1e22-a6fc-4639-906d-d33d13636c18/8affbca5-a77f-46d0-aee9-c8552c7e5233.pdf`
- **Physical File Size**: 4.81 MB (5,042,915 bytes)
- **File SHA-256**: `b2f3a4e51a3e8c774184447bc88b439049cce2f0f3c36530d4aed594d7e0f6f9` (Matches DB record: **YES**)
- **Verified Page Count**: 210 pages
- **Indexing Coverage**: **210 / 210 pages (100% Complete)**
  - Native Text: 179 pages
  - OCR Scanned: 30 pages
  - Explicit Blank: 1 page
  - Unindexed: 0 pages
- **Status**: `COMPLETED` (Fully Indexed)
- **Eligibility**: Excluded from backfill queue (already complete)

#### Volume 2: *2015.67270.How To Win Friends And Influence People*
- **Book ID**: `610a4b42-eb53-4835-855b-112bd6f700b9`
- **Physical File**: `storage/pdfs/e37d1e22-a6fc-4639-906d-d33d13636c18/c8446885-6be6-4185-b4f6-163e8cb4098f.pdf`
- **Physical File Size**: 8.37 MB (8,778,270 bytes)
- **File SHA-256**: `b7047615ab53e26349213866cd8eb3e0347f964bd4286958cb21d49abbbc55f4` (Matches DB record: **YES**)
- **Verified Page Count**: 258 pages
- **Indexing Coverage**: **1 / 258 pages (0.4% Coverage)**
  - Native Text: 1 page (Page 1)
  - OCR Scanned: 0 pages
  - Blank: 0 pages
  - Unindexed: **257 pages**
- **Status**: `PARTIAL`
- **Eligibility**: **Target for Backfill Queue**

---

## 3. Architecture & Implementation

### 3.1 Backend Sequential Queue & Indexing Service
- **Service**: [indexingQueueService.js](file:///Users/cs/Documents/Library/backend/src/services/indexingQueueService.js)
  - `getLibraryIndexingStatus(userId)`: Grouped Prisma aggregation across books, page counts, native/ocr/blank records, and physical file existence.
  - `enqueueLibraryBackfill(userId, options)`: Filters eligible incomplete volumes, creates `PENDING` `OcrJob` records, and starts sequential user queue runner.
  - `processUserQueue(userId)`: Enforces concurrency 1 per user using in-memory mutex and PostgreSQL status tracking (`PENDING` -> `PROCESSING` -> `COMPLETED`).
  - `pauseUserQueue(userId)` / `resumeUserQueue(userId)`: Clean pause/resume state machine.
  - `recoverQueueOnBoot()`: Reconciles interrupted jobs across server restarts.
- **Controller**: [libraryIndexingController.js](file:///Users/cs/Documents/Library/backend/src/controllers/libraryIndexingController.js)
- **Routes**: Mounted at:
  - `GET  /api/ocr/library/status` (and `/api/library/indexing/status`)
  - `POST /api/ocr/library/start` (and `/api/library/indexing/start`)
  - `POST /api/ocr/library/pause` (and `/api/library/indexing/pause`)
  - `POST /api/ocr/library/resume` (and `/api/library/indexing/resume`)
  - `POST /api/ocr/library/retry-failed` (and `/api/library/indexing/retry-failed`)
- **Server Bootstrap**: Updated [server.js](file:///Users/cs/Documents/Library/backend/src/server.js) to execute `IndexingQueueService.recoverQueueOnBoot()` on start.

### 3.2 Reading Room Polish
- **File**: [DocumentSearch.jsx](file:///Users/cs/Documents/Library/frontend/src/components/reader/DocumentSearch.jsx) & [reader.css](file:///Users/cs/Documents/Library/frontend/src/styles/reader.css)
- Replaced colliding `.doc-search-action-btn` 28px square styling with dedicated `.doc-search-index-btn`:
  - `min-width: fit-content`, `height: 30px`, `padding: 6px 14px`, `white-space: nowrap`.
  - `.doc-search-actions-row`: `flex-wrap: wrap; gap: 8px`.
  - Mobile breakpoint ($<480\text{px}$): Full-width centered buttons.

### 3.3 Frontend Indexing Management Interface
- **Component**: [LibraryIndexingDrawer.jsx](file:///Users/cs/Documents/Library/frontend/src/components/library/LibraryIndexingDrawer.jsx)
- **Styles**: [library.css](file:///Users/cs/Documents/Library/frontend/src/styles/library.css)
- **Entry Point**: Added "Search Index" button with gold spark icon in [Library.jsx](file:///Users/cs/Documents/Library/frontend/src/pages/Library.jsx) header.
- **Features**:
  - Live 3.5s polling while queue is processing.
  - 3 Overview Cards: Overall % progress bar, 3-color extraction pill stack, and queue status indicator.
  - Action Bar: "Index All Books", "Pause/Resume Queue", "Retry Failed", internal search box, and status filter tabs (`All`, `Needs Indexing`, `Complete`).
  - Per-Book Row: Multi-segment visual bar (Gold: Native, Teal: OCR, Slate: Blank), detailed metrics, status tags, and individual "Index" / "Retry" action buttons.

---

## 4. Verification & Automated Test Suite

### 4.1 Dedicated Phase OCR-4B Test Suite
- **File**: [libraryIndexing.test.js](file:///Users/cs/Documents/Library/backend/test/libraryIndexing.test.js)
- **Results**: **6 / 6 Passed (100%)**
  1. `401 Unauthorized` enforcement on unauthenticated requests.
  2. `403 Forbidden` enforcement on missing or invalid CSRF tokens.
  3. `GET /api/ocr/library/status` accurate aggregate reporting and file existence verification.
  4. `POST /api/ocr/library/start` sequential queue execution (concurrency 1).
  5. `POST /api/ocr/library/pause` and `/resume` state machine controls.
  6. Multi-tenant isolation: User A and User B cannot view or trigger each other's books.

### 4.2 Full System Regression Suites
- **Backend Full Suite**: **228 / 228 tests passing** (54 test suites)
- **Frontend Full Suite**: **182 / 182 tests passing** (54 test suites)
- **Zero test regressions across the entire codebase.**

---

## 5. Backfill Execution Readiness & Request for Approval

The library-wide indexing system is complete, fully tested, and ready. 

### Proposed Backfill Execution Plan:
1. **Target Volume**: *How to Win Friends and Influence People* (`610a4b42-eb53-4835-855b-112bd6f700b9`).
2. **Pages to Index**: 257 remaining unindexed pages (Page 1 already indexed).
3. **Execution Mode**: Triggered via `POST /api/ocr/library/start` or the frontend "Index All Books" button in the Search Index drawer.
4. **Behavior**:
   - Sequential processing page-by-page.
   - Usable native digital text indexed as `NATIVE` (100% confidence).
   - Scanned pages sent to PaddleOCR worker on port 5060 as `OCR`.
   - Blank pages tagged as `isBlank: true`.
   - Safe pause/resume supported at any time.

> **Safeguard Reminder**: Development protocol strictly prohibits executing the live backfill on `aks_db` before explicit user confirmation.
>
> Please confirm if you approve executing the library-wide backfill for **How to Win Friends and Influence People** (257 unindexed pages).

