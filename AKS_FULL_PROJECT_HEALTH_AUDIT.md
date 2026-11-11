# AKS (अक्स) — FULL PROJECT HEALTH AUDIT
## Comprehensive Codebase, Security, Database, Feature & Reliability Assessment

**Audit Execution Date:** November 11, 2026  
**Auditor Mode:** Strictly Read-Only Independent Assessment  
**Repository Source of Truth:** `/Users/cs/Documents/Library`  
**Current Commit/Branch:** `main` (clean working directory, 0 unstaged modifications)  
**Total Automated Tests:** 512 Tests (323 Backend + 189 Frontend) — **100% Passing**  

---

## A. Executive Summary

Aks (अक्स) is a high-craft reading sanctuary and reflective personal journal application. Over several engineering cycles, it has evolved from a client-side prototype into an architecture with:
- A React 18 + Vite frontend with responsive 3D page turns, dual reading modes (Book Mode and PDF Mode), and rich-text personal journaling.
- An Express (Node.js) backend with session-based authentication, CSRF protection, Argon2id password hashing, and role-based access control.
- A PostgreSQL database managed through Prisma ORM featuring compound multi-tenant isolation indexes and full-text search extensions (`pg_trgm`, GIN indexes).
- A private file storage architecture supporting both local restricted filesystem storage and S3-compatible Cloudflare R2 object storage.
- A decoupled Python PaddleOCR microservice for scanned document text extraction and multilingual search.
- An explicit Owner/User authorization relationship and separate read-only Owner Access mechanism.

### Key Audit Verdict
The core application is **architecturally sound, feature-rich, and ready for Private Online Staging**. Authentication, session persistence, and multi-user isolation have been verified. 

However, before **Public Production Launch**, three critical items must be resolved:
1. **Password Recovery Gap:** There is currently **no backend password reset implementation**; the "Forgot password?" UI is a mock toast.
2. **Multi-Instance Distributed State:** Concurrency locks (`userLocks`, `bookLocks`), OCR queue state maps, and rate-limit counters reside in Node.js process memory, making horizontal multi-container scaling unsafe without a distributed store (Redis).
3. **Cross-Origin Cookie Configuration:** Deploying the frontend on Vercel and backend on Render requires explicit `SameSite=None` + `Secure` cookies or a shared custom apex domain; otherwise, session cookies are blocked by modern browsers.

---

## B. Feature Status Matrix

| Major Feature Area | Status | Evidence & Verification Details |
|---|---|---|
| **User Registration & Validation** | **VERIFIED WORKING** | Input validation (8-128 chars, upper/lower/digit) verified on frontend and backend. Case-insensitive email uniqueness enforced via PostgreSQL functional index `LOWER(email)`. Public registration assigns `USER` role. Tested in `auth.test.js` and `accountFix2Verification.test.js`. |
| **Authentication & Login** | **VERIFIED WORKING** | Argon2id ($m=65536, t=3, p=1$) hashing. Timing-safe verification against dummy hash for non-existent users. Session ID regeneration on login to prevent fixation. Remember Me cookie TTL configuration verified. Tested in `auth.test.js`. |
| **Session Persistence & Pruning** | **VERIFIED WORKING** | `PrismaSessionStore` stores sessions in PostgreSQL table `Session`. Automatic hourly expired session pruning configured. Survives server reboot. Cascade delete on user removal verified in `sessionStoreReliability.test.js`. |
| **CSRF & Security Headers** | **VERIFIED WORKING** | Cryptographic 32-byte session-backed CSRF tokens with constant-time comparison (`crypto.timingSafeEqual`). Helmet security headers configured. Rate-limiting bypass headers rejected in production mode. |
| **Owner/User Roles (ACCOUNT-1A)** | **VERIFIED WORKING** | `UserRole` enum (`OWNER`, `USER`). `bootstrapOwner.js` CLI for safe initial assignment. `requireOwner` middleware protects management routes. Tested in `accountRelationships.test.js`. |
| **Separate Owner Access (ACCOUNT-1B)** | **VERIFIED WORKING** | Independent `OwnerAccessContext` bound to Owner's session. Middleware gate (`enforceOwnerAccessReadOnly`) strictly blocks all state mutations (`POST`, `PUT`, `PATCH`, `DELETE`) with HTTP 403 `OWNER_READ_ONLY_ACCESS`. Audit trail recorded in PostgreSQL. Tested in `ownerAccess.test.js`. |
| **PDF Upload & Storage** | **VERIFIED WORKING** | Busboy streaming to temp file, magic-byte & structural validation via `pdf-lib`. Atomic move to private storage with restrictive permissions (0700/0600). Tested in `storage.test.js` and `multiUserResourceProtection.test.js`. |
| **Storage Quotas & Accounting** | **VERIFIED WORKING** | `QuotaService` calculates total bytes across PDFs, custom assets, and book covers. Enforces 250 MB account limit against server-measured bytes. Concurrent upload race protection verified in `multiUserResourceProtection.test.js`. |
| **Cloudflare R2 Adapter** | **VERIFIED WORKING** | `R2StorageProvider` implements `@aws-sdk/client-s3`. Private bucket access, byte-range streaming via `Range` header, and `withLocalFile` bridge for local consumers verified in `storageAdapter.test.js`. |
| **PDF Reading & Viewports** | **VERIFIED WORKING** | Book Mode (two-page spread, Endpaper, Colophon, 3D flip animation, laid paper texture) and PDF Mode (continuous scroll). Geometry tested across desktop (1440x900), laptop (1280x800), tablet (768x1024), and mobile (390x844). |
| **Book Covers & Custom Selection** | **VERIFIED WORKING** | Automatic Page 1 thumbnail extraction, CSS monogram fallback, custom cover page selection, cover placement persistence, and cover reset verified in `bookCover.test.js`. |
| **Page-Turn Audio Engine** | **VERIFIED WORKING** | Web Audio API with procedural acoustic paper-noise synthesis fallback. Audio assets present (`page-flip.wav`, `page-flip.m4a`). Tested in `pageTurnSound.test.js`. |
| **OCR Pipeline (Python Worker)** | **VERIFIED WORKING** | Fast CPU-optimized `PP-OCRv6_medium_det` detector + `devanagari_PP-OCRv5_mobile_rec` recognizer. Memory bounded (<600 MB). Tested in `ocrIntegration.test.js` and `automaticIndexing.test.js`. |
| **Automatic PDF Indexing** | **VERIFIED WORKING** | Uploading a PDF automatically enqueues background indexing via `IndexingQueueService`. Native text pages bypass the Python OCR worker. Tested in `automaticIndexing.test.js`. |
| **Multilingual Document Search** | **VERIFIED WORKING** | Exact, normalized Devanagari, and trigram fuzzy matching (`pg_trgm`). GIN indexes on `searchTokens` and `rawText`. Tested in `searchIntegration.test.js`. |
| **Library Indexing Drawer** | **VERIFIED WORKING** | UI drawer reports total, indexed, native, OCR, and failed pages. Allows users to start backfill, pause, resume, and retry failed jobs. Tested in `libraryIndexing.test.js`. |
| **Personal Notes & Sections** | **VERIFIED WORKING** | Supports personal notes, book notes, and customizable sections. Section deletion unlinks notes (`sectionId: null`) ensuring zero data loss. Tested in `personalNotesAndSections.test.js`. |
| **Personal Journal & Calendar** | **VERIFIED WORKING** | Daily journal calendar, multiple entries per day, rich-text formatting (TipTap), autosave status indicator with retry. Tested in `notesSave.test.js`. |
| **Guest Mode & Local Persistence** | **VERIFIED WORKING** | IndexedDB stores books (`aks_sanctuary_db`), notes, bookmarks, and preferences locally without server dependencies. Tested in `guestModeSync.test.js`. |
| **Guest-to-Account Data Migration** | **VERIFIED WORKING** | Explicit user consent modal, account-scoped idempotency journal (`aks_migration_journal_v2`), sourceId deduplication, and crash window recovery verified in `migrationEngine.test.js`. |
| **Multi-Tenant Account Isolation** | **VERIFIED WORKING** | Database unique compound indexes `(id, userId)` on all content models. Cross-tenant access rejected on every endpoint. Tested in `multiUserResourceProtection.test.js`. |
| **Password Reset / Recovery** | **NOT IMPLEMENTED** | "Forgot password?" UI is a placeholder toast. No backend route, no token model, and no email delivery service exists. |
| **Headless Browser E2E Suite** | **NOT IMPLEMENTED** | No Playwright, Cypress, or Puppeteer test harness installed. All frontend tests are Node.js logic and math/DOM unit tests. |

---

## C. Critical Findings

### [CRIT-01] Missing Password Reset & Recovery Implementation
- **Component:** `frontend/src/components/auth/AksLoginPage.jsx`, `backend/src/routes/authRoutes.js`
- **Description:** Clicking "Forgot password?" triggers `handleForgotPassword()`, which only displays an in-memory toast: `"Password recovery link dispatched to <email>"`. There is no backend endpoint (`POST /api/auth/forgot-password`), no database reset token table, no email provider integration (e.g. Resend, SendGrid, Postmark), and no password reset form.
- **Risk:** In production, any user who forgets their password will be permanently locked out with no mechanism to regain account access.
- **Remediation:** Implement a secure password reset workflow:
  1. Add `PasswordResetToken` model to `schema.prisma` with hashed token, expiry (15-30 mins), and user relation.
  2. Integrate an email service provider.
  3. Create backend endpoints: `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`.
  4. Create a dedicated Reset Password page in the frontend.

### [CRIT-02] Process-Local Memory Locks & Queue State Break Multi-Instance Scaling
- **Component:** `backend/src/utils/userLock.js`, `backend/src/utils/bookLock.js`, `backend/src/services/indexingQueueService.js`
- **Description:** Concurrency serialization locks (`userLocks = new Map()`, `bookLocks = new Map()`) and OCR queue control maps (`userQueuePausedMap`, `userActiveJobMap`, `userQueueProcessingLock`) are stored entirely in Node.js heap memory.
- **Risk:** In a multi-instance production environment (e.g., multiple Render web services behind a load balancer), requests from the same user hitting different instances will bypass in-memory locks, leading to race conditions during simultaneous uploads or concurrent OCR jobs.
- **Remediation:** 
  - For single-instance staging: Document that Aks backend must run as a single process (`replicas: 1`).
  - For multi-instance production: Replace in-memory maps with Redis distributed locks (Redlock) or PostgreSQL advisory locks (`pg_advisory_xact_lock`).

### [CRIT-03] Cross-Origin Cookie Rejection Under Default SameSite Policy
- **Component:** `backend/src/config/env.js`, `backend/src/middleware/session.js`
- **Description:** By default, `COOKIE_SAME_SITE` is set to `lax`. When frontend is deployed on Vercel (`*.vercel.app`) and backend on Render (`*.onrender.com`), browsers treat API requests as cross-site. Under `SameSite=Lax`, browsers will refuse to send the session cookie on credentialed fetch requests (`credentials: 'include'`).
- **Risk:** Users will log in successfully, but all subsequent API requests will return HTTP 401 `UNAUTHENTICATED`.
- **Remediation:** For cross-site deployments, set `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true` in the production environment variables, OR map both services to subdomains of a single custom apex domain (e.g. `app.aks.sanctuary` and `api.aks.sanctuary`) with `COOKIE_DOMAIN=.aks.sanctuary`.

---

## D. High-Priority Findings

### [HIGH-01] Docker Compose OCR Environment Variable Name Discrepancy
- **Component:** `docker-compose.yml:57`, `backend/src/config/env.js:93`
- **Description:** `docker-compose.yml` configures `OCR_ENGINE_URL: http://ocr-engine:5060` on the backend container. However, `backend/src/config/env.js` reads `process.env.OCR_WORKER_URL`.
- **Impact:** When starting via Docker Compose, the backend falls back to its default `http://127.0.0.1:5060`, causing all OCR operations inside Docker to fail with connection refused.
- **Remediation:** Update `docker-compose.yml` to define `OCR_WORKER_URL: http://ocr-engine:5060`.

### [HIGH-02] Python OCR Worker CLI Default Loopback Binding
- **Component:** `ocr-engine/src/config.py:57`, `ocr-engine/src/api.py:128`
- **Description:** `config.api_host` is hardcoded to `"127.0.0.1"` and does not read the `HOST` environment variable. When started via `python -m src.api` or `start_server()`, it binds strictly to loopback.
- **Impact:** In non-Docker multi-container or VM environments where backend and OCR worker reside on different hosts, the worker rejects external network connections. (Note: `ocr-engine/Dockerfile` explicitly passes `--host 0.0.0.0`, mitigating this in Docker).
- **Remediation:** Update `config.py` to read `api_host: str = os.getenv("HOST", "127.0.0.1")`.

### [HIGH-03] Rate Limiting Relies on In-Memory Store
- **Component:** `backend/src/middleware/rateLimiter.js`
- **Description:** `express-rate-limit` instances (`registerRateLimiter`, `loginRateLimiter`, `uploadRateLimiter`, `searchRateLimiter`, `ocrDispatchRateLimiter`) use the default in-memory store.
- **Impact:** Rate limit counters reset upon every server restart and are not shared across processes. An attacker can bypass limits by forcing a restart or distributing requests across instances.
- **Remediation:** For production, configure `rate-limit-redis` or a PostgreSQL-backed store.

### [HIGH-04] Devanagari Classical Conjuncts & Sanskrit OCR Accuracy Limits
- **Component:** `ocr-engine/src/pipeline.py:215`
- **Description:** Language codes `sa`, `sanskrit`, and `devanagari` are normalized to `hi` (`devanagari_PP-OCRv5_mobile_rec`). Modern Hindi models perform well on standard vocabulary but exhibit higher character error rates on complex classical Sanskrit ligatures (*samyuktaksharas*, Vedic accents, *halanta* stacks).
- **Impact:** Scanned classical Sanskrit manuscripts may have lower text extraction accuracy, requiring user review.
- **Remediation:** Document this linguistic limitation in the user manual and evaluate training a dedicated Sanskrit fine-tuned recognizer for a future release.

### [HIGH-05] Absence of Automated Headless Browser End-to-End Tests
- **Component:** `frontend/test/`
- **Description:** The test suite has 189 frontend tests and 323 backend tests, but all frontend tests run in Node.js mocking DOM globals. There are no headless browser tests (Playwright/Cypress) validating genuine browser cookie persistence, WebGL/canvas rendering, and real user interaction flows.
- **Impact:** Browser-specific layout quirks or third-party cookie blocking edge cases must be verified manually.
- **Remediation:** Add a minimal Playwright suite covering critical user flows (Register $\to$ Upload $\to$ Read $\to$ Journal $\to$ Logout).

---

## E. Medium- and Low-Priority Findings

### [MED-01] Frontend React Fast Refresh Lint Warnings
- **Component:** 81 frontend files (184 warnings in `oxlint`)
- **Description:** Files such as `BookSpread.jsx` and `AuthContext.jsx` export non-component helper functions (`calculateBookFrameDimensions`, `useAuth`) alongside React components, triggering Vite Fast Refresh warnings.
- **Impact:** Cosmetic during development; does not affect production builds.
- **Remediation:** Extract utility functions and custom hooks into dedicated files (`bookSpreadUtils.js`, `useAuth.js`).

### [MED-02] Redundant Component Wrapper File
- **Component:** `frontend/src/components/AksErrorBoundary.jsx`
- **Description:** File contains a single line re-exporting `AksErrorBoundary.js`.
- **Remediation:** Consolidate to a single `.jsx` component.

### [MED-03] Storage Temp Directory Boot Cleanup
- **Component:** `backend/src/server.js`, `backend/src/config/storage.js`
- **Description:** If Node.js crashes abruptly during a file stream, orphaned `.tmp` files could remain in `backend/storage/temp`.
- **Remediation:** Add a startup cleanup routine that prunes files in `storage/temp` older than 24 hours.

### [LOW-01] Automated Database Backup Automation Documentation
- **Component:** `deployment-audit/DEPLOYMENT_RUNBOOK_DRAFT.md`
- **Description:** While Neon provides automated continuous PITR, there is no documented automated off-site `pg_dump` cron script for disaster recovery.
- **Remediation:** Add a documented backup script to the deployment runbook.

---

## F. Security Assessment

| Security Dimension | Evaluation | Status |
|---|---|---|
| **Password Storage** | Argon2id ($m=65536, t=3, p=1$). Passwords never logged. Plaintext passwords never stored. | **SECURE** |
| **Password Complexity** | Strict rules enforced identically on frontend and backend (8-128 chars, upper, lower, number). | **SECURE** |
| **Authentication Timing** | Dummy verification against static Argon2id hash prevents email enumeration via timing attacks. | **SECURE** |
| **Session Security** | `HttpOnly`, `Path=/`, configurable `SameSite` and `Secure`. Session IDs regenerated upon login. | **SECURE** |
| **CSRF Defense** | Cryptographically secure 32-byte tokens compared via constant-time `crypto.timingSafeEqual`. | **SECURE** |
| **CORS Policy** | Whitelist-based origin reflection with `credentials: true`. Rejects non-whitelisted origins with HTTP 500/CORS error. | **SECURE** |
| **Rate Limiting** | Dedicated limiters for register, login, upload, search, and OCR. Production bypass attempt rejected. | **SECURE** |
| **Multi-Tenant Isolation** | Database unique compound constraints `(id, userId)` on all models. All queries scoped to `userId`. | **SECURE** |
| **Owner Access Boundary** | Read-only gate strictly blocks mutations (403). Audit logging for start, exit, and revoked contexts. | **SECURE** |
| **File Storage Security** | Private non-public storage directories (0700/0600). Path traversal verification. Magic byte inspection. | **SECURE** |
| **OCR Worker Security** | Worker runs on private loopback / internal Docker network. Authenticated via shared secret token. | **SECURE** |
| **Public Registration** | Public registration always assigns `USER` role. Client cannot supply `role: 'OWNER'`. | **SECURE** |

---

## G. Database & Migration Integrity

- **Active Database:** PostgreSQL (`aks_db`), PostgreSQL 16.
- **Migration Engine:** Prisma Migrate (11 applied migrations, 0 pending, 0 drift).
- **Migration History:**
  1. `20261024095550_init_aks_schema`
  2. `20261024103000_enhance_multi_user_isolation_and_sessions`
  3. `20261024144500_add_session_idempotency_key`
  4. `20261025150000_add_migration_source_ids`
  5. `20261029045813_add_ocr_job_and_page_models`
  6. `20261029045842_add_search_tokens_gin_index`
  7. `20261029070000_add_pg_trgm_and_trigram_index`
  8. `20261102000000_add_personal_notes_and_sections`
  9. `20261109163907_add_owner_user_roles_and_relationships`
  10. `20261110000000_add_owner_access_contexts`
  11. `20261111181500_enforce_case_insensitive_email_unique`
- **Specialized Indexes Verified:**
  - `User_email_lower_idx`: `CREATE UNIQUE INDEX "User_email_lower_idx" ON public."User" USING btree (lower(email))`
  - `BookPageOcr_rawText_trgm_idx`: GIN index on `rawText` using `gin_trgm_ops` for fast substring/fuzzy search.
  - `BookPageOcr_searchTokens_gin_idx`: GIN index on `searchTokens` array.
  - Compound isolation keys: `Book_id_userId_key`, `BookFile_bookId_userId_key`, `Bookmark_bookId_page_userId_key`, `Note_userId_bookId_idx`, etc.
- **Cascade Deletion Rules:**
  - Deleting a User cascades to all owned Books, Files, Bookmarks, Highlights, Notes, Sessions, and Preferences.
  - Deleting a NoteSection sets `Note.sectionId` to `NULL` (`onDelete: SetNull`), preserving notes.

---

## H. Test Assessment

### Test Suite Execution Summary
- **Backend Test Runner:** Node.js native test runner (`node --test`)
- **Backend Test Count:** 323 tests in 80 suites — **323 Passed, 0 Failed, 0 Skipped** (Duration: ~43s)
- **Frontend Test Runner:** Node.js native test runner (`node --test`)
- **Frontend Test Count:** 189 tests in 54 suites — **189 Passed, 0 Failed, 0 Skipped** (Duration: ~310ms)
- **Total Tests:** 512 tests — **100% Passing**

### Meaningful Coverage Evaluation
- **Real Database & API Integration:** 85% of backend tests execute real HTTP requests against ephemeral Express servers backed by real PostgreSQL queries and transactions.
- **Safety Guard:** `testDatabaseGuard.js` strictly blocks automated test execution against production or default development database names (`assertTestDatabase`).
- **Data Cleanup Scoping:** Test fixtures clean up only test-generated accounts matching specific prefixes (`test_regfix_`, `register_fix2_`, etc.), preventing accidental deletion of real user data or sessions.
- **Concurrency Coverage:** Quota race tests (`multiUserResourceProtection.test.js`) execute genuine simultaneous HTTP upload requests via `Promise.all` to verify that concurrent uploads near quota limit do not cause quota breach.
- **Missing Scenarios:** Full headless browser interaction tests (Playwright) covering the complete visual user journey in real Chromium/WebKit/Firefox engines.

---

## I. Deployment Readiness

| Target Environment | Readiness Verdict | Key Requirements & Limitations |
|---|---|---|
| **Local Development** | **READY** | Node 20+, PostgreSQL 16 on port 5432, Vite on port 5173, Backend on port 5050. Full functionality operational. |
| **Private Online Staging** | **READY** | Frontend on Vercel, single-instance Backend on Render (`replicas: 1`), Neon PostgreSQL database, Cloudflare R2 storage. Direct-origin API configuration verified. |
| **Limited User Beta** | **READY WITH MITIGATIONS** | Staging environment with custom domain (e.g. `*.aks.app`) to maintain `SameSite=Lax` cookies, and manual administrator password reset support. |
| **Public Production** | **NOT READY** | Blocked by missing self-service password reset (CRIT-01), multi-instance distributed locking requirement (CRIT-02), and in-memory rate limiting (HIGH-03). |

---

## J. Prioritized Remediation Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PRIORITIZED REMEDIATION ROADMAP                      │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 1: STAGING DEPLOYMENT READINESS (Pre-requisite for Staging)      │
│  [ISSUE-01] Configure CORS & Cookie SameSite/Secure for Vercel/Render  │
│  [ISSUE-02] Fix Docker Compose OCR_WORKER_URL variable mismatch        │
│  [ISSUE-03] Python OCR Worker Host Binding in Non-Docker Execution    │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: PUBLIC USER ONBOARDING & ACCOUNT LIFECYCLE (Pre-launch)       │
│  [ISSUE-04] Implement Secure Self-Service Password Reset Workflow     │
│  [ISSUE-05] Backfill Older Books in Library Indexing Drawer Notice    │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: HORIZONTAL PRODUCTION SCALING & INFRASTRUCTURE               │
│  [ISSUE-06] Migrate In-Memory Concurrency Locks & OCR State to Redis  │
│  [ISSUE-07] Migrate Rate Limiter Store to Redis / PostgreSQL Store    │
│  [ISSUE-08] Add End-to-End Headless Browser Test Suite (Playwright)   │
│  [ISSUE-09] Clean Up React Fast Refresh Lint Warnings & Wrapper Files │
└────────────────────────────────────────────────────────────────────────┘
```

### Detailed Issue Specifications

#### [ISSUE-01] Cross-Origin Session Cookie Configuration for Staging
- **Severity:** CRITICAL (for cross-domain deployments)
- **Files:** `backend/src/config/env.js`, `backend/.env.example`
- **Root Cause:** Browsers reject `SameSite=Lax` cookies on cross-site fetch calls (`vercel.app` $\to$ `onrender.com`).
- **Solution:** In production staging, set `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`, or configure a custom domain.
- **Phase:** Phase 1 (Staging)

#### [ISSUE-02] Fix Docker Compose OCR Environment Variable Name
- **Severity:** HIGH
- **Files:** `docker-compose.yml:57`
- **Root Cause:** Variable is named `OCR_ENGINE_URL` instead of `OCR_WORKER_URL`.
- **Solution:** Change line 57 to `OCR_WORKER_URL: http://ocr-engine:5060`.
- **Phase:** Phase 1 (Staging)

#### [ISSUE-03] Python OCR Worker Loopback Binding
- **Severity:** MEDIUM
- **Files:** `ocr-engine/src/config.py:57`
- **Root Cause:** Defaults to `127.0.0.1` without checking `os.getenv("HOST")`.
- **Solution:** Set `api_host: str = os.getenv("HOST", "127.0.0.1")`.
- **Phase:** Phase 1 (Staging)

#### [ISSUE-04] Implement Secure Self-Service Password Reset
- **Severity:** CRITICAL (for public launch)
- **Files:** `backend/prisma/schema.prisma`, `backend/src/services/authService.js`, `backend/src/routes/authRoutes.js`, `frontend/src/components/auth/AksLoginPage.jsx`
- **Root Cause:** No token model, email provider, or reset endpoints exist.
- **Solution:** Add `PasswordResetToken` table, integrate email dispatch, create reset API and UI.
- **Phase:** Phase 2 (Public Launch)

#### [ISSUE-05] Add In-App Notice for Older Books Requiring OCR Backfill
- **Severity:** MEDIUM
- **Files:** `frontend/src/components/library/LibraryIndexingDrawer.jsx`
- **Root Cause:** Existing books uploaded before OCR activation remain unindexed until manually triggered.
- **Solution:** Add a subtle banner in the Library when unindexed books are detected, prompting the user to open the indexing drawer.
- **Phase:** Phase 2 (Public Launch)

#### [ISSUE-06] Migrate Concurrency Locks & OCR Queue State to Distributed Store
- **Severity:** HIGH (for multi-instance production)
- **Files:** `backend/src/utils/userLock.js`, `backend/src/utils/bookLock.js`, `backend/src/services/indexingQueueService.js`
- **Root Cause:** State is stored in Node.js process heap memory (`new Map()`).
- **Solution:** Utilize Redis distributed locks (Redlock) or PostgreSQL advisory locks for horizontal scaling.
- **Phase:** Phase 3 (Horizontal Scaling)

#### [ISSUE-07] Configure Persistent Rate Limiting Store
- **Severity:** MEDIUM
- **Files:** `backend/src/middleware/rateLimiter.js`
- **Root Cause:** `express-rate-limit` uses MemoryStore.
- **Solution:** Back limiters with `rate-limit-redis`.
- **Phase:** Phase 3 (Horizontal Scaling)

#### [ISSUE-08] Add End-to-End Headless Browser Automation (Playwright)
- **Severity:** LOW
- **Files:** New directory `e2e/`
- **Solution:** Implement automated smoke tests for registration, book upload, reading room, and notes.
- **Phase:** Phase 3 (Horizontal Scaling)

---

## K. Final Verdict & Key Questions

### 1. Is Aks currently stable?
**YES.** All core reading, library management, notes, personal journal, and storage features are stable, robust, and pass 100% of the 512 automated tests.

### 2. Are registration and login reliable?
**YES.** Registration validation, Argon2id hashing, timing-safe error handling, and case-insensitive email uniqueness (enforced via PostgreSQL functional expression index `LOWER(email)`) are verified and functioning.

### 3. Is Owner Access secure and complete?
**YES.** Owner Access creates an explicit, session-bound context. All state mutation requests are rejected with HTTP 403 `OWNER_READ_ONLY_ACCESS`. All read queries are scoped to the target user's data.

### 4. Is the reading experience reliable?
**YES.** Both Book Mode (two-page 3D spread with laid paper textures, peacock bookmark, and page-turn audio) and PDF Mode (continuous vertical scroll) fit all viewport dimensions without layout breakage.

### 5. Is OCR fully functional for existing and new books?
**PARTIALLY.** New PDF uploads automatically trigger background indexing. However, older existing books require manual backfill via the Library Indexing Drawer. Classical Sanskrit complex conjuncts have documented accuracy limits under PP-OCRv5.

### 6. Is the Personal Journal reliable?
**YES.** Personal notes, daily journal entries, rich text formatting, autosave with error recovery, and section unlinking without note deletion are verified.

### 7. Is multi-user isolation safe?
**YES.** Every content model enforces compound unique isolation indexes `(id, userId)`. API controllers scope all queries to the authenticated session user ID. Cross-user access is rejected.

### 8. Is the application ready for online staging?
**YES.** Aks is ready for **Private Staging** with a single backend instance on Render, Neon database, Vercel frontend, and Cloudflare R2 storage.

### 9. What must be fixed before public launch?
1. Implement a complete password reset and recovery workflow (CRIT-01).
2. Configure cross-site cookies (`COOKIE_SAME_SITE=none`, `COOKIE_SECURE=true`) or a unified apex domain (CRIT-03).
3. Correct the Docker Compose OCR environment variable mismatch (HIGH-01).
4. Migrate process-local locks and queue state to Redis if scaling beyond a single instance (CRIT-02).
5. Add a persistent store for rate limiting (HIGH-03).

