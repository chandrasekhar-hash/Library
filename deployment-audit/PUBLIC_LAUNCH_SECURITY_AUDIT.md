# Aks (अक्स) — Public Launch Security & Multi-Tenant Audit

**Audit Date:** November 2, 2026  
**Scope:** Public Launch Security, Multi-Tenant Data Isolation, Authentication, Authorization, Abuse Prevention.

---

## 1. Security Item Classification Matrix

| Security Feature | Implementation Status | Severity / Status | Code Location |
|---|---|---|---|
| **Public Registration** | Implemented & Verified | **Pass** | [backend/src/controllers/authController.js](file:///Users/cs/Documents/Library/backend/src/controllers/authController.js#L37-L49) |
| **Password Hashing (Argon2id)** | Implemented & Verified | **Pass** | [backend/src/services/passwordService.js](file:///Users/cs/Documents/Library/backend/src/services/passwordService.js#L18-L34) |
| **Session Fixation Defense** | Implemented & Verified | **Pass** | [backend/src/controllers/authController.js](file:///Users/cs/Documents/Library/backend/src/controllers/authController.js#L70-L82) |
| **Database-Backed Sessions** | Implemented & Verified | **Pass** | [backend/src/services/sessionStore.js](file:///Users/cs/Documents/Library/backend/src/services/sessionStore.js#L20-L80) |
| **CSRF Protection** | Implemented & Verified | **Pass** | [backend/src/middleware/csrf.js](file:///Users/cs/Documents/Library/backend/src/middleware/csrf.js#L45-L84) |
| **CORS Policy** | Implemented & Verified | **Pass** | [backend/src/middleware/security.js](file:///Users/cs/Documents/Library/backend/src/middleware/security.js#L21-L49) |
| **User Multi-Tenant Isolation** | Implemented & Verified | **Pass** | Enforced across all Prisma queries via composite keys `[id, userId]` |
| **Private File Authorization** | Implemented & Verified | **Pass** | [backend/src/controllers/bookFileController.js](file:///Users/cs/Documents/Library/backend/src/controllers/bookFileController.js#L311-L328) |
| **Path Traversal Protection** | Implemented & Verified | **Pass** | [backend/src/services/storageService.js](file:///Users/cs/Documents/Library/backend/src/services/storageService.js#L48-L65) |
| **Upload Format Validation** | Implemented & Verified | **Pass** | Magic bytes `%PDF-` and image headers validated before storage |
| **Auth Endpoint Rate Limiting** | Implemented & Verified | **Pass** | [backend/src/middleware/rateLimiter.js](file:///Users/cs/Documents/Library/backend/src/middleware/rateLimiter.js#L19-L39) |
| **Email Verification** | **MISSING** | **High** | Any email (real or fake) can register immediately |
| **Password Reset / Recovery** | **MISSING** | **High** | No forgot-password endpoint or email token workflow exists |
| **Per-User Storage Quota** | **MISSING** | **High** | Users can upload unlimited 150 MB PDFs until disk/storage fills up |
| **File Upload Rate Limiting** | **MISSING** | **Medium** | No rate limit on `POST /api/books/:id/file` |
| **OCR Trigger Rate Limiting** | **MISSING** | **Medium** | No rate limit on OCR job dispatch |
| **Search Query Rate Limiting** | **MISSING** | **Medium** | No rate limit on `/api/books/:id/search` (potential DoS via trigram scan) |

---

## 2. In-Depth Security Findings & Vulnerabilities

### Finding SEC-01: Missing Email Verification (Severity: HIGH)
- **Observed Behavior:** In [backend/src/controllers/authController.js](file:///Users/cs/Documents/Library/backend/src/controllers/authController.js#L37-L49), `registerUser({ name, email, password })` immediately creates an active account in PostgreSQL and permits immediate login.
- **Risk:**
  1. Attackers can register accounts using victim email addresses (e.g., `ceo@company.com`).
  2. Spambots can mass-create fake accounts, exhausting Neon's 500 MB database storage quota.
- **Required Fix Before Public Launch:**
  1. Add an `emailVerified` boolean and `verificationToken` timestamp to the `User` schema.
  2. Integrate an email delivery service (e.g. Resend / SendGrid / Postmark free tiers) to send verification links.

### Finding SEC-02: Missing Password Reset Self-Service (Severity: HIGH)
- **Observed Behavior:** There are no endpoints for `/api/auth/forgot-password` or `/api/auth/reset-password`.
- **Risk:** If any public user forgets their password, they are permanently locked out of their personal journal entries, private notes, and uploaded books. Administrators would have to manually update password hashes in PostgreSQL via SQL.
- **Required Fix Before Public Launch:**
  1. Create a `PasswordResetToken` model in Prisma with 1-hour expiration and cryptographic hashing.
  2. Implement `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`.

### Finding SEC-03: Unbounded User Storage & Missing Storage Quota (Severity: HIGH)
- **Observed Behavior:** In [backend/src/controllers/bookFileController.js](file:///Users/cs/Documents/Library/backend/src/controllers/bookFileController.js#L26-L70), the only limit is a per-file size check (`MAX_UPLOAD_SIZE_MB: 150MB`). There is no check on total accumulated storage per user.
- **Risk:** A single malicious user can create 10 books and upload 10 × 150 MB files (1.5 GB), quickly exhausting Cloudflare R2's free 10 GB limit or crashing the backend.
- **Required Fix Before Public Launch:**
  1. Enforce a global per-user storage cap (e.g., max 200 MB or max 5 books total per free account).
  2. Calculate `SELECT SUM(fileSizeBytes) FROM BookFile WHERE userId = ...` before accepting new file streams.

### Finding SEC-04: Unprotected Resource-Intensive Endpoints (Severity: MEDIUM)
- **Observed Behavior:** While `registerRateLimiter` and `loginRateLimiter` exist in [backend/src/middleware/rateLimiter.js](file:///Users/cs/Documents/Library/backend/src/middleware/rateLimiter.js), they are only mounted on `/api/auth/register` and `/api/auth/login`.
- **Endpoints Missing Rate Limits:**
  - `POST /api/books/:bookId/file` (File upload processing)
  - `POST /api/books/:bookId/ocr` (Asynchronous OCR job spawning)
  - `GET /api/books/:bookId/search?q=...` (PostgreSQL trigram GIN text search)
- **Risk:** A script can send thousands of heavy search queries or trigger massive native text extractions, pinning the Render CPU at 100%.
- **Required Fix:** Apply general IP and session-based rate limiters (e.g. 60 requests/minute for search; 5 uploads/hour for files).

---

## 3. Multi-Tenant Isolation Verification

A rigorous review of database queries confirmed that **data leakages between authenticated users are effectively prevented**:

1. **Books:** Queries in [backend/src/controllers/bookController.js](file:///Users/cs/Documents/Library/backend/src/controllers/bookController.js) consistently use `where: { id: bookId, userId: req.userId }`.
2. **PDF Streaming:** [backend/src/controllers/bookFileController.js](file:///Users/cs/Documents/Library/backend/src/controllers/bookFileController.js#L311-L328) explicitly validates that the requesting `userId` owns the requested book file before opening a file read stream.
3. **Personal Journal & Notes:** [backend/src/controllers/noteController.js](file:///Users/cs/Documents/Library/backend/src/controllers/noteController.js) and [backend/src/controllers/noteSectionController.js](file:///Users/cs/Documents/Library/backend/src/controllers/noteSectionController.js) strictly filter by `userId: req.userId`.
4. **Database-Level Protection:** Composite unique indexes (`@@unique([id, userId])`, `@@unique([bookId, userId])`) prevent accidental cross-tenant record collision at the PostgreSQL level.

