# Aks (अक्स) — Search Index Coverage Bug Investigation & Audit Report

**Audit Date**: November 1, 2026  
**Target Book**: *From Shiva to Schrödinger: Unravelling Cosmic Secrets with Trika Shaivism and Quantum Insights*  
**Book ID**: `2fc57cbc-d02a-4d85-bd8f-104edd8d4e63`  
**User ID**: `e37d1e22-a6fc-4639-906d-d33d13636c18`  
**Investigator**: Aks Engineering / Antigravity AI  
**Scope**: Read-Only Indexing Lifecycle, Database Verification & Root-Cause Analysis  

---

## Executive Summary

When searching for the query `"advent"` inside *From Shiva to Schrödinger*, the Reading Room returns 0 results and displays a partial-indexing warning:  
`"This volume has 205 unindexed page(s). Results may be partial until OCR processing completes."`  
The term `"advent"` is visibly present in plain digital text on **Page 10** of the original PDF (`"The advent of quantum physics was radically novel in myriad ways."`), yet search fails to locate it.

### Key Audit Findings
1. **The physical PDF is digital and fully readable**: 179 of the 210 pages contain clean, digital native text. Scanning all 210 pages with `NativeTextExtractor` takes under **3.5 seconds** (19 ms/page).
2. **Page 10 has NO record in `BookPageOcr`**: Only 5 pages exist in the database (Pages 1, 2, 3, 4, 205).
3. **The 5 existing records are synthetic test artifacts**: Inspection reveals that Pages 2, 3, and 4 contain Hindi prose from Munshi Premchand's *Godan* and Sanskrit shlokas from the *Bhagavad Gita*. These were inserted directly into the production database by an automated test script (`scratch/run_full_browser_acceptance_3d.mjs`) during Phase OCR-3D acceptance testing, which wiped the table and hardcoded 5 mock pages.
4. **No OCR/Indexing Job Ever Ran**: There is **0** `OcrJob` record in the database for this book (`ocrJobs: []`).
5. **Systemic Architectural Gap**: When a user uploads a PDF via `POST /api/books/:bookId/file`, the backend saves the PDF file to disk, but **never queues an indexing job**. Furthermore, the frontend has **no trigger or button** to initiate indexing. Consequently, **every uploaded book in the system is currently unindexed (0% or near-0% coverage)** unless manually manipulated by test scripts.
6. **Search Engine Correctness Verified**: When Page 10 is extracted natively and evaluated through `SearchEngine.searchBook`, it immediately discovers `"advent"` as a **Tier 1 EXACT match** with confidence `1.0`, line bounding box `[[77, 314], [535, 314], [535, 329], [77, 329]]`, and highlighted snippet `Preface The <mark>advent</mark> of quantum physics was radically novel in myriad …`.

---

## 1. Database & Asset Evidence for the Affected Book

### 1.1 Book & File Record
```json
{
  "id": "2fc57cbc-d02a-4d85-bd8f-104edd8d4e63",
  "title": "From Shiva to Schrödinger: Unravelling Cosmic Secrets with Trika Shaivism and Quantum Insights",
  "totalPages": 210,
  "file": {
    "id": "31c567a0-83f5-4f02-b2e4-aab292a4b6a9",
    "filename": "_OceanofPDF.com_From_Shiva_to_Schrodinger_-_Mrittunjoy_Guha_Majumdar.pdf",
    "fileSizeBytes": 5042915,
    "storagePath": "pdfs/e37d1e22-a6fc-4639-906d-d33d13636c18/8affbca5-a77f-46d0-aee9-c8552c7e5233.pdf"
  }
}
```

### 1.2 Quantitative Metrics Breakdown
| Metric | Database Count | Expected for Complete Index |
| :--- | :--- | :--- |
| **Total PDF Page Count** | **210** | 210 |
| **Total `BookPageOcr` Records** | **5** | 210 |
| **NATIVE Records** | **2** (Pages 1, 205) | 179 |
| **OCR Records** | **3** (Pages 2, 3, 4 - synthetic Hindi) | 31 (front/back matter & illustrations) |
| **Failed Pages** | **0** | 0 |
| **Pending Pages** | **0** | 0 |
| **Processing Pages** | **0** | 0 |
| **`OcrJob` Records** | **0** (`null`) | At least 1 `COMPLETED` job |
| **Page 10 DB Record Exists?** | **NO** | YES |
| **Stored Text for Page 10** | **None** (`null`) | 24 lines, 1,420 chars |

### 1.3 Inspection of the 5 Existing Database Records
| Page | Source | Snippet in DB | Provenance |
| :--- | :--- | :--- | :--- |
| **1** | `NATIVE` | `"In Trika Shaivism and Indian philosophy, the individual soul..."` | Hardcoded by `scratch/run_full_browser_acceptance_3d.mjs:79` |
| **2** | `OCR` | `"होरी सेमर गाँव का एक सीधा-साधा किसान था। धनिया ने चौखट पर..."` | Hardcoded Premchand *Godan* from test script line 105 |
| **3** | `OCR` | `"कर्मण्येवाधिकारस्ते मा फलेषु कदाचन..."` | Hardcoded *Gita* shloka from test script line 138 |
| **4** | `OCR` | `"रायसाहब अमरपाल सिंह इलाके के प्रतिष्ठित जमींदार थे..."` | Hardcoded Premchand *Godan* from test script line 150 |
| **205** | `NATIVE` | `"The concluding synthesis of modern physics and quantum mechanics."` | Hardcoded test stub from test script line 160 |

---

## 2. Complete Indexing Lifecycle Trace (10 Questions Addressed)

### 1. How a book enters the OCR/search indexing pipeline
- **Implementation**: `backend/src/controllers/bookFileController.js` (`uploadBookFile`).
- **Trace**: When a PDF is uploaded, `uploadBookFile` streams the file to temporary storage, verifies the PDF magic bytes (`%PDF-`), calls `validatePdfStructure`, and moves the file to user storage.
- **Finding**: **There is no invocation of `OcrJobService` upon upload.** The upload handler terminates after writing to `BookFile`. The indexing pipeline is only triggered if an external caller explicitly issues `POST /api/books/:bookId/ocr`.

### 2. How native PDF text extraction determines whether a page needs OCR
- **Implementation**: `NativeTextExtractor.isTextUsable(text, options)` in `backend/src/services/nativeTextExtractor.js`.
- **Criteria**:
  1. `text.trim().length >= 25` characters (`minChars`).
  2. At least 5 alphanumeric words of length $> 1$ (`minWords`).
  3. Character density: $\ge 30\%$ of characters must be valid alphanumeric glyphs.
- **Finding**: This heuristic correctly distinguishes native digital text from blank/scanned pages. On the affected book, 179 of 210 pages are identified as `isUsable: true`.

### 3. Whether native-text pages are indexed individually or in batches
- **Implementation**: `OcrJobService.executeJob` (lines 223–407).
- **Finding**: Native-text pages are processed **individually in a sequential loop** (`for (let pageNum = 1; pageNum <= totalPages; pageNum++)`). While sequentially safe for memory bounding, each page executes an independent `prisma.bookPageOcr.upsert` and `prisma.ocrJob.update`, taking ~19 ms per page.

### 4. How OCR jobs are queued and processed
- **Implementation**: `OcrJobService.requestJob` & `OcrJobService.executeJob`.
- **Trace**:
  1. Verifies book ownership and file existence.
  2. Ensures no active job (`PENDING` or `PROCESSING`) exists.
  3. Inserts an `OcrJob` row with status `PENDING`.
  4. Fires `setImmediate(() => this.executeJob(jobId))`.
  5. In `executeJob`: iterates 1 to $N$. Tries `NativeTextExtractor.extractPageText`. If usable, persists as `NATIVE`. If unusable, calls Python worker `ocrClient.processPdf` with `startPage: pageNum - 1, maxPages: 1`.
  6. Final status set to `COMPLETED` (or `FAILED` if all failed).

### 5. Whether processing stops after the first 5 pages
- **Finding**: **No.** There is no loop break or 5-page ceiling in `OcrJobService.executeJob`. The presence of exactly 5 pages is 100% attributable to `scratch/run_full_browser_acceptance_3d.mjs`, which explicitly deleted all records for `book1Id` and inserted 5 mock fixtures.

### 6. Whether pages with native text are incorrectly skipped or marked as processed without saving searchable records
- **Finding**: Inside `executeJob`, if `isUsable` is true, it immediately upserts into `prisma.bookPageOcr`. However, if native extraction throws an error or fails `isTextUsable`, it cascades to OCR. If the OCR worker also fails or throws a page error, **the catch block logs `pageError.message`, increments `failedCount++`, but writes NO record to `BookPageOcr`**. The page is silently left out of the search index.

### 7. Whether page numbers are correctly mapped between PDF.js, backend extraction, and PostgreSQL
- **Finding**: **Yes, mapping is strictly 1-based across all tiers:**
  - PDF.js: `doc.getPage(pageNumber)` uses 1-based indexing.
  - Backend: `NativeTextExtractor.extractPageText` uses 1-based `pageNumber`.
  - Database: `BookPageOcr.pageNumber` is 1-based.
  - Python OCR Worker: `startPage: pageNum - 1` correctly converts 1-based backend page to 0-based Python PDFium page.
  - Search Engine: returns 1-based `pageNumber`.
  - Frontend: `onNavigate(match.pageNumber)` passes 1-based `pageNumber` to `ReaderPage.jsx`.

### 8. Whether search coverage counts include both NATIVE and OCR page records
- **Implementation**: `SearchEngine.getBookOcrStatusSummary` in `backend/src/services/searchEngine.js`:
  ```javascript
  const indexedPages = await prisma.bookPageOcr.count({ where: { bookId, userId } });
  const nativePages = await prisma.bookPageOcr.count({ where: { bookId, userId, source: 'NATIVE' } });
  const ocrPages = await prisma.bookPageOcr.count({ where: { bookId, userId, source: 'OCR' } });
  ```
- **Finding**: **Yes.** Both `NATIVE` and `OCR` sources are counted towards `indexedPages`.

### 9. Whether failed pages are retried or silently left unindexed
- **Finding**: If an individual page fails during a job, it is **silently left unindexed**. If at least one other page succeeded, `finalStatus` is marked as **`COMPLETED`** (line 415: `const finalStatus = (failedCount > 0 && processedCount === 0) ? 'FAILED' : 'COMPLETED'`). The failed pages are not automatically retried unless an administrative API calls `POST /api/books/:bookId/ocr/retry`.

### 10. Whether the frontend status reflects actual database indexing progress
- **Finding**: **Yes.** The frontend drawer accurately displays:
  - `indexedPages`: 5
  - `totalPages`: 210
  - `unindexedPages`: 205
  - Warning banner: `"This volume has 205 unindexed page(s). Results may be partial until OCR processing completes."`
  The frontend UI is faithfully displaying the exact state of PostgreSQL; the defect is that PostgreSQL was never populated with the real book pages.

---

## 3. Verification of Page 10 Native Text & Search Engine Matching

To confirm that the search engine works when the page record exists, we executed an isolated, read-only simulation:

### 3.1 Native Extraction of Page 10
- **Line Count**: 24 lines
- **Total Characters**: 1,420
- **Line 2 Text**: `"The advent of quantum physics was radically novel in myriad ways."`
- **Line 2 Bounding Box**: `[[77, 314], [535, 314], [535, 329], [77, 329]]` (72 DPI PDF coordinates)

### 3.2 SearchEngine Evaluation for Query `"advent"`
- **Tier**: Tier 1 (`EXACT`)
- **Score**: `1.0`
- **Match Char Index**: `12`
- **Extracted Snippet**: `Preface The advent of quantum physics was radically novel in myriad …`
- **Highlighted Snippet**: `Preface The <mark>advent</mark> of quantum physics was radically novel in myriad …`
- **Bbox Match**: Mapped to Line 2 bounding box with 100% confidence.

**Conclusion**: As soon as Page 10 is indexed in PostgreSQL, the search engine and Reading Room highlighting operate as intended.

---

## 4. System-Wide Impact: Is This Book-Specific?

An audit across all books in the database was performed:

```
[f4021374] "Permissions Test Book"         (Total: 1p)   | Indexed: 0p | Jobs: 0
[610a4b42] "How To Win Friends..."         (Total: 258p) | Indexed: 1p | Jobs: 0
[5c0e0c2d] "Architectures of Reflection"   (Total: 120p) | Indexed: 0p | Jobs: 0
[051040e2] "Architectures of Reflection"   (Total: 120p) | Indexed: 0p | Jobs: 0
[2fc57cbc] "From Shiva to Schrödinger"     (Total: 210p) | Indexed: 5p | Jobs: 0
```

### Result: **The issue affects ALL books across the platform.**
- No book uploaded through the standard UI has full index coverage.
- The platform lacks an automatic ingestion pipeline to index books upon upload or upon opening the reader.

---

## 5. Root Causes

| ID | Category | Root Cause Description |
| :--- | :--- | :--- |
| **RC-1** | **Ingestion Architecture** | `uploadBookFile` in `bookFileController.js` handles physical upload and integrity validation, but never enqueues an indexing job (`OcrJobService.requestJob`). |
| **RC-2** | **Frontend Capability** | The frontend (`frontend/src/`) contains zero calls to `POST /api/books/:bookId/ocr`. There is neither an auto-trigger on reader mount nor an "Index this book" button in the search drawer. |
| **RC-3** | **Acceptance Test Pollution** | The test suite (`scratch/run_full_browser_acceptance_3d.mjs`) directly executed `prisma.bookPageOcr.deleteMany` on the user's book `2fc57cbc...` and inserted 5 mock pages (including Hindi *Godan* text), leaving 205 pages unindexed and overwriting real content. |
| **RC-4** | **Heavy vs. Light Pipeline Coupling** | Native digital extraction (fast: ~3 seconds for 210 pages) was coupled directly to the Python OCR worker lifecycle rather than running as an immediate, lightweight ingestion step on upload. |

---

## 6. Recommended Minimal Fix (Implementation Plan)

When approved, the fix requires two concise, targeted changes:

### Step 1: Automatic Fast-Path Native Ingestion on PDF Upload
In `backend/src/controllers/bookFileController.js`:
After `moveToPermanentStorage` and `prisma.bookFile.upsert` succeed, automatically trigger `OcrJobService.requestJob({ userId, bookId: book.id, language: 'en' })`.
Because `OcrJobService.executeJob` already runs `NativeTextExtractor` first, digital books like *From Shiva to Schrödinger* will have all 179+ readable pages indexed in ~3.5 seconds in the background without user intervention.

### Step 2: Add "Index Book" / "Re-index" Trigger in Search Drawer
In `frontend/src/components/reader/DocumentSearch.jsx`:
When `ocrStatus.unindexedPages > 0` and `!ocrStatus.activeJob`, display an **"Index Book"** or **"Start Indexing"** button next to the partial-indexing warning. Clicking it issues `POST /api/books/:bookId/ocr` (with CSRF protection), enabling the user to start indexing on demand and watch real-time progress.

### Step 3: Clean Re-Indexing of Affected Book
Trigger `OcrJobService.requestJob({ userId: 'e37d1e22-a6fc-4639-906d-d33d13636c18', bookId: '2fc57cbc-d02a-4d85-bd8f-104edd8d4e63', force: true })` to purge the 5 synthetic mock pages and fully index all 210 pages of *From Shiva to Schrödinger*.

---

## 7. Required Tests

1. **Unit Test**: `test/nativeTextExtractor.test.js` — Test full-document extraction on a multi-page digital PDF to verify all pages with text produce `BookPageOcr` entries.
2. **Integration Test**: `test/bookUploadIndexing.test.js` — Verify that uploading a PDF automatically enqueues and starts native indexing.
3. **Search Test**: `test/searchCoverage.test.js` — Query `"advent"` on *From Shiva to Schrödinger* and assert HTTP 200 with Page 10 returned, exact match type, and bounding box coordinates.
4. **UI Regression Test**: Verify that the Reading Room search drawer shows `210/210 indexed`, warning banner disappears, and selecting Page 10 navigates and highlights `"advent"`.

---
*Report completed. No application code, database migrations, or user records were altered.*

