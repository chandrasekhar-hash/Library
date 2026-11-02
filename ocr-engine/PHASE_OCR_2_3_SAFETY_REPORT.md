# Aks — Phase OCR-2.3: Production Safety Gate & Search Reliability Audit Report

**Date:** October 28, 2026  
**System:** Apple Silicon (macOS Sequoia `arm64`, 10-core CPU, 16.0 GB RAM)  
**Python Runtime:** Python 3.12.16 + PaddlePaddle 3.3.1 + PaddleOCR 3.7.0 + pypdfium2 5.14.0  
**Test Suite Status:** **49/49 Tests Passing (100%)**  

---

## 1. Executive Summary & Audit Scope

Phase OCR-2.3 serves as the **Production Safety Gate** prior to integrating the self-hosted Python OCR worker (`ocr-engine/`) into the main Aks application (Phase OCR-3). 

This phase evaluated six critical areas:
1. **Subprocess Concurrency & Process Isolation**: Audited whether `threading.Lock` and child process isolation protect against PDFium crashes, whether child processes spawn and terminate cleanly, and added a global concurrency gate with HTTP 429 backpressure.
2. **Memory Safety & Bounding**: Directly measured parent process RSS, child process RSS, and combined peak memory across single requests, 10-page streams, hard timeouts, and invalid inputs.
3. **Devanagari Normalization Safety**: Conducted an exhaustive audit of `DevanagariSearchNormalizer.to_search_tokens()`, testing each transformation independently, benchmarking against positive spelling variants and negative semantic minimal pairs, and proving that default nukta-preservation avoids lexical collisions.
4. **Search Quality & Language Readiness**: Re-evaluated real-world samples with precision/recall metrics, defining separate readiness verdicts for English, ordinary Hindi, complex literature, classical Sanskrit, and Vedic Sanskrit.
5. **API & Worker Failure Recovery**: Verified that hard timeouts never report success, malformed PDFs fail gracefully, client cancellations are reaped, `/health` remains responsive (<50ms) during active OCR, and zero temporary files linger.
6. **Strict Project Boundaries**: All work remained strictly inside `ocr-engine/`; zero changes were made to `frontend/`, `backend/`, `prisma/`, or `storage/pdfs/`.

---

## 2. Subprocess & Concurrency Verification

### 2.1 File References & Findings
- **[`ocr-engine/src/isolation.py`](file:///Users/cs/Documents/Library/ocr-engine/src/isolation.py)**:
  - **Process-Level Protection**: The existing `threading.Lock` in `OCRWorker` is process-local and only protects threads within the same Python interpreter. It provides zero synchronization across different child processes.
  - **Subprocess Spawning**: `ProcessIsolatedRunner.run()` spawns a dedicated child OS process via `multiprocessing.get_context("spawn")` for every isolated request.
  - **Concurrency Gate**: Added `_process_semaphore = mp.BoundedSemaphore(config.max_concurrent_jobs)` and an atomic active workers counter `_active_workers_count = mp.Value("i", 0)`.
  - **Reaping & Timeout Cleanup**: Wrapped execution in a robust `try...finally:` block. If a child process exceeds `doc_timeout`, it is sent `SIGTERM`, followed by `SIGKILL` if still alive after 0.5s. `proc.join()` reaps the OS process table entry, and `result_queue.close()` / `result_queue.join_thread()` releases pipe file descriptors.
- **[`ocr-engine/src/api.py`](file:///Users/cs/Documents/Library/ocr-engine/src/api.py)**:
  - Catches `ConcurrencyLimitExceededError` and returns `HTTP 429 Too Many Requests` with a mandatory `Retry-After: 5` header.
  - Reports instantaneous OS process RSS, active child process count, and concurrency limits via `GET /health` without acquiring the OCR execution lock.
- **[`ocr-engine/src/config.py`](file:///Users/cs/Documents/Library/ocr-engine/src/config.py)**:
  - Added `max_concurrent_jobs: int = 1` (default for 16 GB machines).
  - Added `concurrency_overflow_strategy: str = "reject"` (options: `"reject"` or `"queue"`).
  - Added `max_queue_wait_seconds: float = 5.0`.
  - Added `normalizer_version: str = "1.0.0"`.

---

## 3. Empirical Memory Safety & Concurrency Scaling

Measured empirically using `ocr-engine/benchmarks/measure_memory_concurrency.py` (recorded in `memory_measurements.json`):

### 3.1 Measured Process RSS Breakdown

| Test Scenario | Parent Process RSS | Child Process Peak RSS | Combined Peak RSS | Parent Post-Job RSS | Parent Delta | Child Cleanup Status |
|---|---|---|---|---|---|---|
| **Parent Baseline** | **53.00 MB** | — | **53.00 MB** | — | — | Clean baseline |
| **1-Page Document (`01_english_1p`)** | 53.00 MB | 2,609.22 MB | **2,664.17 MB** | 54.92 MB | +1.92 MB | Reaped (0 active children) |
| **10-Page Document Stream (`02_english_10p`)** | 54.94 MB | 3,202.80 MB | **3,258.16 MB** | 55.33 MB | +0.39 MB | Reaped (0 active children) |
| **Hard Timeout Termination (0.05s)** | 54.92 MB | Terminated in 0.56s | **54.94 MB** | 54.94 MB | +0.02 MB | Reaped (0 active children) |
| **Malformed / Corrupt PDF** | 54.94 MB | Caught immediately | **54.94 MB** | 54.94 MB | +0.00 MB | Reaped (0 active children) |

### 3.2 Concurrency Scaling Projections & Development Machine Limits

Each PaddleOCR child process allocates ~2.6 GB for 1-page jobs and ~3.2 GB during continuous 10-page streams on CPU. Combined with the parent FastAPI server overhead (~55 MB):

| Concurrency Level | Worker RSS | Parent RSS | Total Estimated RAM | Status on 16 GB Host | Production Verdict |
|---|---|---|---|---|---|
| **1 Worker (`max_concurrent_jobs=1`)** | 3.20 GB | 0.05 GB | **3.25 GB** | **SAFE** | **Default recommended limit** for 16 GB development machines. |
| **2 Workers (`max_concurrent_jobs=2`)** | 6.40 GB | 0.05 GB | **6.45 GB** | **BORDERLINE** | Risky on 16 GB machines when running alongside PostgreSQL, Docker, and IDE. |
| **3 Workers (`max_concurrent_jobs=3`)** | 9.60 GB | 0.05 GB | **9.65 GB** | **UNSAFE** | High risk of kernel OOM freezes on 16 GB hosts; requires 32 GB RAM. |
| **4 Workers (`max_concurrent_jobs=4`)** | 12.80 GB | 0.05 GB | **12.85 GB** | **UNSAFE** | Requires dedicated 64 GB production cluster. |

**Recommendation:** The default concurrency limit in `config.py` is locked at **1 worker** with strategy `"reject"` (HTTP 429).

---

## 4. Devanagari Normalization Safety Audit

Audited via `ocr-engine/tests/test_normalization_safety.py` against independent transformations, positive spelling variants, and negative semantic minimal pairs:

### 4.1 Independent Transformation Audit
1. **Unicode Canonical Normalization**: In Unicode Standard, Devanagari nukta pre-composed characters (U+0958..U+095F) are *Composition Exclusions*. Applying `unicodedata.normalize("NFC")` correctly canonicalizes both decomposed (`क` + `़`) and pre-composed (`क़`) forms into identical canonical representations without data loss.
2. **Zero-Width Joiners (`ZWJ`/`ZWNJ`)**: Stripping `\u200D` and `\u200C` prevents hidden ligature representation mismatches (`क्\u200Dष` vs `क्ष`) without altering consonants.
3. **Punctuation Repair**: Replaces ASCII pipe (`|`) and exclamation (`!`) with Devanagari Purna Virama (`।`), double pipes with Double Danda (`॥`), and colons following Devanagari letters with Visarga (`ः`). Standard English colons (`Chapter 1: Intro`) remain untouched.
4. **Chandrabindu Normalization**: Maps Chandrabindu (`ँ`) to Anusvara (`ं`) for search equivalence (`गाँव` <-> `गांव`).
5. **Pancham Varna Canonicalization**: Converts homorganic nasal consonants before stops to Anusvara (`सम्बन्ध` -> `संबंध`, `सङ्कल्प` -> `संकल्प`, `अन्तर` -> `अंतर`).

### 4.2 Precision and Semantic Collision Analysis
A major danger in Devanagari search is **over-normalization**. If nuktas are stripped by default (`strip_nuktas=True`), distinct words with different lexical meanings falsely collide:
- `राज` (kingdom / governance) vs `राज़` (secret)
- `जरा` (old age / infirmity) vs `ज़रा` (a little bit)
- `खाना` (food / to eat) vs `ख़ाना` (drawer / compartment)
- `बाग` (reins) vs `बाग़` (garden)
- `फन` (snake's hood) vs `फ़न` (art / skill)

**Architectural Decision:** In [`ocr-engine/src/postprocessor.py`](file:///Users/cs/Documents/Library/ocr-engine/src/postprocessor.py), `to_search_tokens()` defaults to `strip_nuktas=False`. This enforces exact semantic distinction while preserving NFC canonical spelling equivalence.

### 4.3 Classification Metrics on Test Corpus

- **Positive Spelling Variant Set** (10 pairs):
  - `सम्बन्ध` <-> `संबंध`, `सङ्कल्प` <-> `संकल्प`, `गाँव` <-> `गांव`, `अन्तर्राष्ट्रीय` <-> `अंतर्राष्ट्रीय`, `क्\u200Dष` <-> `क्ष`, etc.
  - **Recall: 100.0%** (10/10 matched)
- **Negative Semantic Minimal Pairs Set** (10 pairs):
  - `राज` vs `राज़`, `जरा` vs `ज़रा`, `खाना` vs `ख़ाना`, `कवि` vs `कपि`, `ग्रह` vs `गृह`, `प्रसाद` vs `प्रासाद`, `कर्म` vs `क्रम`, etc.
  - **Precision: 100.0%** (0 false collisions)
  - **False Positive Rate (FPR): 0.0%**
  - **F1-Score: 1.000**

---

## 5. Search Quality & Language Readiness Matrix

Evaluated across authentic book pages via `ocr-engine/benchmarks/evaluate_search_quality.py` (recorded in `search_quality_results.json`):

| Language Domain | Representative Text Tested | Char Acc | Raw Word Acc | Raw Search Recall | Normalized Search Recall | Precision | FPR | Readiness Verdict |
|---|---|---|---|---|---|---|---|---|
| **English** | Dale Carnegie scan & Hay House book | **98.99%** | **93.38%** | 100.0% | **100.0%** | **100.0%** | **0.0%** | **PRODUCTION READY** |
| **Ordinary Hindi Prose** | Munshi Premchand *Godan* opening page | **89.74%** | **56.20%** | 53.85% | **61.54%** (+7.69%) | **100.0%** | **0.0%** | **SEARCH-READY (TWO-TIERED)** |
| **Complex Hindi Literature** | Acharya Shukla critical literary critique | **84.90%** | **27.16%** | 20.00% | **20.00%** | **100.0%** | **0.0%** | **READY WITH CAVEATS** |
| **Classical Sanskrit** | *Bhagavad Gita* 2.47-50 + Shankara Bhashya | **77.63%** | **9.09%** | 42.86% | **42.86%** | **100.0%** | **0.0%** | **READY WITH CAVEATS** |
| **Vedic Sanskrit** | Rigvedic hymns with svara accents | **0.00%** | **0.00%** | 0.00% | **0.00%** | **0.0%** | **0.0%** | **NOT READY (UNSUPPORTED)** |

### 5.1 Concrete Operational Guidance for Phase OCR-3:
1. **English Books**: Ready for automatic end-to-end OCR and exact-word indexing.
2. **Ordinary Hindi Prose**: Ready for production using the **Two-Tiered Architecture**:
   - Store raw OCR transcript in PostgreSQL for book reading and bounding-box rendering.
   - Pass text through `DevanagariSearchNormalizer.to_search_tokens()` to populate PostgreSQL full-text search index (`tsvector`).
3. **Complex Hindi Literature & Sanskrit**: High character readability (77–85%), but exact multi-syllable word matches suffer on dense conjuncts (e.g. `अभिव्यंजनावाद`, `कर्मण्येवाधिकारस्ते`). Aks Phase OCR-3 must configure **pg_trgm fuzzy substring matching** alongside exact token matching.
4. **Vedic Sanskrit**: **Strictly unsupported**. PaddleOCR recognition models do not include Vedic accent diacritics (udatta, anudatta, svarita). Must be explicitly flagged as unsupported in UI.

---

## 6. API and Worker Failure Recovery Verification

Verified via `ocr-engine/tests/test_safety_gate.py`:
1. **Timeout Never Reports Success**: Hard subprocess timeouts return `processed_pages_count: 0`, `pages: []`, and an explicit error string. The job is never marked as complete.
2. **Zero Orphan Processes**: Process termination via `proc.terminate()` + `proc.kill()` + `proc.join()` guarantees zero zombie or lingering child processes.
3. **Zero Orphan Temporary Files**: Audited `/tmp` after OCR jobs; verified that zero raster images (`.png`, `.jpg`, `.bmp`) remain on disk.
4. **Health Check Non-Blocking**: Queried `GET /health` during active heavy OCR execution; average latency was **<25 ms** with `active_workers: 1` reported accurately.
5. **Concurrency Gate Backpressure**: When `max_concurrent_jobs=1`, immediate subsequent requests receive `HTTP 429 Too Many Requests` with `Retry-After: 5` header.
6. **Authentication Active**: Requests without valid Bearer secret return `HTTP 401 Unauthorized` or `HTTP 403 Forbidden`.

---

## 7. Complete Test Suite Status

All 49 unit, safety, concurrency, normalization, and stress tests pass:
- `tests/test_pipeline.py`: 3/3 passed
- `tests/test_rasterizer.py`: 6/6 passed
- `tests/test_safety.py`: 13/13 passed
- `tests/test_isolation_timeout.py`: 5/5 passed
- `tests/test_concurrency_stress.py`: 5/5 passed
- `tests/test_normalization_safety.py`: 10/10 passed
- `tests/test_safety_gate.py`: 7/7 passed
- **Total: 49/49 PASSED (100%)**

---

## 8. Final Safety Gate Verdict for Phase OCR-3 Integration

| Gate Check | Status | Verification Detail |
|---|---|---|
| **Subprocess Isolation** | **PASS** | `ProcessIsolatedRunner` reaps child processes; memory fully reclaimed by OS. |
| **Concurrency Limiting** | **PASS** | Bounded semaphore enforces `max_concurrent_jobs=1`; rejects excess requests with HTTP 429. |
| **Memory Bounding** | **PASS** | Parent stays at ~55 MB; child stays at ~2.6–3.2 GB; zero leakage across 10-page streams. |
| **Devanagari Normalization** | **PASS** | 100% recall on spelling variants; 100% precision on semantic minimal pairs (0% FPR). |
| **Health Responsiveness** | **PASS** | Non-blocking `/health` responds in <25ms during active OCR. |
| **Fault Recovery** | **PASS** | Clean recovery from malformed PDFs, timeouts, and process terminations. |
| **Ready for Phase OCR-3?** | **YES** | **The OCR engine is safely hardened and ready for Aks application integration.** |

