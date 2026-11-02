# Aks (अक्स) — Phase OCR-4A: Target Book Recovery Report

**Execution Date**: November 1, 2026  
**Target Book**: *From Shiva to Schrödinger: Unravelling Cosmic Secrets with Trika Shaivism and Quantum Insights*  
**Book ID**: `2fc57cbc-d02a-4d85-bd8f-104edd8d4e63`  
**Owner User ID**: `e37d1e22-a6fc-4639-906d-d33d13636c18` (`abhisek07abhi@gmail.com`)  
**Recovery Job ID**: `7500d08e-8673-4ba9-9de7-681ff113b78f`  
**Final Status**: **COMPLETED (100% Verified in PostgreSQL)**  

---

## 1. Pre-Execution Safety & Backup Verification

Prior to modifying any record in PostgreSQL, all safety pre-conditions and database backups were generated and strictly verified:

### 1.1 PostgreSQL Backup Verification
A complete snapshot of the database was dumped and verified using the active PostgreSQL 18.6 binaries:
* **Custom Format Binary Archive**: `scratch/backups/aks_db_pre_recovery.dump` (155,247 bytes)
* **Plain Text SQL Archive**: `scratch/backups/aks_db_pre_recovery.sql` (247,589 bytes)
* **Archive Integrity Check**: Executed `pg_restore -l scratch/backups/aks_db_pre_recovery.dump`. Output confirmed 123 valid table, type, index, and constraint TOC entries.

### 1.2 Target Book & Physical File Verification
* **Book ID**: `2fc57cbc-d02a-4d85-bd8f-104edd8d4e63`
* **Title**: *From Shiva to Schrödinger: Unravelling Cosmic Secrets with Trika Shaivism and Quantum Insights*
* **Total Pages**: 210
* **Storage Path**: `pdfs/e37d1e22-a6fc-4639-906d-d33d13636c18/8affbca5-a77f-46d0-aee9-c8552c7e5233.pdf`
* **File Size**: 5,042,915 bytes
* **Calculated SHA-256**: `b2f3a4e51a3e8c774184447bc88b439049cce2f0f3c36530d4aed594d7e0f6f9`
* **Integrity**: 100% bitwise match with `BookFile` database record. The physical PDF was **left completely unmodified**.

---

## 2. Records Removed and Provenance

Only the five synthetic test fixtures identified during Phase 1 investigation were deleted:
```sql
DELETE FROM "BookPageOcr"
WHERE "bookId" = '2fc57cbc-d02a-4d85-bd8f-104edd8d4e63'
  AND "userId" = 'e37d1e22-a6fc-4639-906d-d33d13636c18'
  AND "pageNumber" IN (1, 2, 3, 4, 205);
```

### Justification & Provenance of Removed Records
| Page | Source | Content Removed | Original Provenance |
| :--- | :--- | :--- | :--- |
| **1** | `NATIVE` | Synthetic Trika Shaivism stub | Hardcoded by `scratch/run_full_browser_acceptance_3d.mjs:79` |
| **2** | `OCR` | Munshi Premchand *Godan* prose (`होरी सेमर गाँव...`) | Hardcoded by `scratch/run_full_browser_acceptance_3d.mjs:105` |
| **3** | `OCR` | *Bhagavad Gita* 2.47 verse (`कर्मण्येवाधिकारस्ते...`) | Hardcoded by `scratch/run_full_browser_acceptance_3d.mjs:138` |
| **4** | `OCR` | Munshi Premchand *Godan* prose (`रायसाहब अमरपाल सिंह...`) | Hardcoded by `scratch/run_full_browser_acceptance_3d.mjs:150` |
| **205** | `NATIVE` | Synthetic quantum physics stub | Hardcoded by `scratch/run_full_browser_acceptance_3d.mjs:160` |

*No genuine user text was deleted. Zero records from other books or users were affected.*

---

## 3. Recovery Execution Details

* **Indexing Job ID**: `7500d08e-8673-4ba9-9de7-681ff113b78f`
* **Trigger**: Normal idempotent pipeline (`OcrJobService.requestJob`)
* **Execution Duration**: 156.3 seconds
* **Final Job Status**: `COMPLETED`
* **Error Message**: `null`

### Actual Page Classification vs. Dry-Run Estimate
| Classification | Dry-Run Estimate | Actual Post-Recovery Count | Description |
| :--- | :--- | :--- | :--- |
| **Total Pages** | 210 | **210** | Complete book accounted for |
| **NATIVE Records** | 179 | **179** | Digital pages extracted in ~3.5s via `NativeTextExtractor` |
| **OCR Records** | 0 | **30** | Cover, title, copyright, table of contents, and chapter plates |
| **BLANK Records** | 31 | **1** | Purely blank divider page (Page 46: `isBlank: true`) |
| **Failed Pages** | 0 | **0** | **0 errors, 0 retries required** |
| **Duplicate Pages** | 0 | **0** | Unique set: exactly 1 record per page for $1 \le p \le 210$ |

*Note on actual vs. estimate*: During the initial dry-run scan, 31 pages were flagged as lacking digital native text. When sent to PaddleOCR, **30 of those pages contained real scanned text** (e.g. the book cover, copyright disclosures, section headings, and illustrations with text), while **1 page was genuinely blank**. All 31 pages were properly processed and recorded.

---

## 4. Page 10 Authentic Text & Search Verification

### 4.1 Page 10 Stored Database Record
* **Page Number**: `10`
* **Source**: `NATIVE`
* **Recognition Confidence**: `1.0` (100%)
* **Line Count**: 24 lines
* **Dimensions**: 595 × 842 pt (A4/Standard Portrait)
* **First Lines of Stored Text**:
  ```text
  Preface
  The advent of quantum physics was radically novel in myriad ways.
  Physics was no longer deterministic. Reality no longer seemed to be
  sacrosanct sans the observer. It brought with it fundamental questions on
  the boundaries of a system: how the system interacts with its environment...
  ```

### 4.2 Live Search Engine Verification for `"advent"`
Queried `SearchEngine.searchBook` with `query = "advent"`:
* **Total Matches in Volume**: 5 occurrences across the book
* **Top Result**:
  * **Page Number**: `10`
  * **Match Type**: `EXACT` (Tier 1)
  * **Score**: `1.0`
  * **Line Index**: `1` (Line 2 of page)
  * **Snippet**: `"Preface The advent of quantum physics was radically novel in myriad …"`
  * **Highlighted Snippet**: `"Preface The <mark>advent</mark> of quantum physics was radically novel in myriad …"`
  * **Bounding Box**: `[[77, 314], [535, 314], [535, 329], [77, 329]]` (exact 72 DPI PDF coordinates)

### 4.3 Search Coverage Overview Status
* `totalPages`: `210`
* `indexedPages`: `210`
* `unindexedPages`: `0`
* `isFullyIndexed`: `true`
* `warning`: `null` (The partial-indexing warning banner has been dismissed)

---

## 5. Protected User Data: Before & After Audit

| User Asset / State | Before Recovery | After Recovery | Status |
| :--- | :--- | :--- | :--- |
| **Book ID** | `2fc57cbc-d02a...` | `2fc57cbc-d02a...` | **Preserved (Identical)** |
| **Book Title** | *From Shiva to Schrödinger* | *From Shiva to Schrödinger* | **Preserved (Identical)** |
| **Book Owner** | `e37d1e22-a6fc...` | `e37d1e22-a6fc...` | **Preserved (Identical)** |
| **PDF File SHA-256** | `b2f3a4e51a3e...` | `b2f3a4e51a3e...` | **Preserved (Bitwise Identical)** |
| **Physical PDF on Disk** | 5,042,915 bytes | 5,042,915 bytes | **Untouched** |
| **Bookmarks Count** | 2 | 2 | **Preserved (Pages 50, 54)** |
| **Reading Progress** | Page 8 (3.81%) | Page 8 (3.81%) | **Preserved** |
| **Notes & Highlights** | 0 | 0 | **Preserved** |
| **Other User Books** | 19 volumes | 19 volumes | **Completely Untouched** |

---

## 6. Conclusion

The recovery of *From Shiva to Schrödinger* is **100% complete and verified against the live PostgreSQL database**:
1. All 210 pages are fully indexed without duplicate records.
2. Usable native digital text was correctly prioritized over heavy OCR.
3. The five synthetic test fixtures (including Hindi Premchand prose) have been purged and replaced with the author's authentic work.
4. Searching `"advent"` locates Page 10 with millimeter-accurate bounding-box highlights.
5. All bookmarks, reading progress, and private user files remained untouched.

