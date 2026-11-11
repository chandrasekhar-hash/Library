# Aks (अक्स) — Free Hosting Compatibility Audit

**Audit Date:** November 2, 2026  
**Target Architecture:**
- **Frontend:** Vercel (React 19 + Vite)
- **Backend:** Render (Node.js + Express 4)
- **Database:** Neon (PostgreSQL 16)
- **File Storage:** Cloudflare R2
- **OCR Engine:** Self-hosted Python PaddleOCR microservice

---

## 1. Executive Summary

This audit evaluates the feasibility of hosting Aks on free cloud tiers for public, multi-user access.

### Feasibility Verdict: **Partially Feasible on Pure Free Tiers with Specific Architecture Constraints**

| Component | Target Free Provider | Compatibility Verdict | Critical Blocker / Condition |
|---|---|---|---|
| **Frontend UI** | Vercel (Hobby / Free) | **Fully Compatible** | Requires rewrites rule (`/api/*` ➔ Render backend) to prevent third-party cookie blocking. |
| **Backend API** | Render (Free Web Service) | **Compatible with Restrictions** | 15-minute sleep cold starts (~50s delay); ephemeral disk requires external storage (Cloudflare R2). |
| **Database** | Neon (Free Tier) | **Fully Compatible** | PostgreSQL 16 with `pg_trgm` extension supported; requires `sslmode=require` and unpooled connection for migrations. |
| **User File Storage** | Cloudflare R2 (Free Tier) | **Compatible after Code Refactor** | Current code writes directly to local POSIX disk (`fs.createReadStream`); needs S3 SDK integration. |
| **Scanned OCR Worker** | Render (Free Container) | **INCOMPATIBLE ON FREE TIER** | PaddleOCR + PyMuPDF requires > 1.2 GB RAM. Render free tier provides 512 MB RAM (instant OOM crash). |
| **Native Digital PDF Search** | Render (Free Node.js) | **Fully Compatible** | `pdfjs-dist` text extraction runs inside Node.js (< 60 MB RAM) without the Python OCR worker. |

---

## 2. Component Feasibility Breakdown

### 2.1 Frontend on Vercel
- **Root Directory:** `frontend/`
- **Build Output:** `dist/` (configured in `vite.config.js`)
- **Routing:** SPA navigation is state-based (`activeNav` in [frontend/src/App.jsx](file:///Users/cs/Documents/Library/frontend/src/App.jsx#L62-L73)); no server-side route collisions.
- **API Configuration:** [frontend/src/services/api.js](file:///Users/cs/Documents/Library/frontend/src/services/api.js#L12) reads `VITE_API_BASE_URL`. If left empty and paired with a Vercel rewrite (`/api/:match*` ➔ `https://<render-backend>/api/:match*`), requests become same-origin, completely avoiding third-party cookie blocking (`SameSite=Lax`).
- **Verdict:** 100% compatible on Vercel Free Hobby tier.

### 2.2 Backend on Render
- **Root Directory:** `backend/`
- **Build Command:** `npm install && npx prisma generate`
- **Start Command:** `npm start` (executes `node src/server.js`)
- **Memory & CPU Limits:** 512 MB RAM, 0.1 CPU core.
- **Cold Starts:** Spins down after 15 minutes of inactivity. First wake-up takes 30–50 seconds.
- **Ephemeral Storage Risk:** Render's free tier wipes local disk upon container restart or redeploy. Any PDF, cover thumbnail, or user asset stored in `backend/storage/` will be destroyed unless migrated to Cloudflare R2.
- **Verdict:** Compatible for API routing, auth, and database operations, but **cannot rely on local disk for persistence**.

### 2.3 Database on Neon
- **Engine:** Managed PostgreSQL 16 with native pooling.
- **Free Quota:** 0.5 GB (500 MB) storage, 100 compute hours / month, auto-suspend after 5 minutes inactivity.
- **Extension Support:** `pg_trgm` and `uuid-ossp` are pre-compiled and fully supported on Neon.
- **Indexing & Queries:** GIN index on `searchTokens` and GIN trigram index on `rawText` work natively on Neon.
- **Migration Caution:** Neon provides a pooled connection string (port 5432 with PgBouncer) and a direct unpooled connection string. Prisma migrations (`prisma migrate deploy`) must execute against the unpooled direct connection URL.
- **Verdict:** 100% compatible on Neon Free tier.

### 2.4 File Storage on Cloudflare R2
- **Free Quota:** 10 GB storage, 1,000,000 Class A operations (writes), 10,000,000 Class B operations (reads), $0 egress bandwidth fees.
- **Code Reality:** Current codebase ([backend/src/controllers/bookFileController.js](file:///Users/cs/Documents/Library/backend/src/controllers/bookFileController.js#L340-L425)) directly invokes `fs.promises.stat()`, `fs.createReadStream()`, and `fs.createWriteStream()`.
- **Refactoring Required:** An S3-compatible adapter must be implemented to upload to R2 and stream byte ranges via R2 or generate signed URLs for PDF.js.
- **Verdict:** Feasible and free, but requires code changes before deploying to Render.

### 2.5 OCR Service on Free Hosting
- **Architecture:** Python FastAPI + PyMuPDF + PaddleOCR ([ocr-engine/src/worker.py](file:///Users/cs/Documents/Library/ocr-engine/src/worker.py)).
- **Resource Footprint:**
  - Base Python + PyMuPDF runtime: ~120 MB RAM.
  - PaddlePaddle Deep Learning Framework + detection model + recognition model: ~900 MB – 1.4 GB RAM during active page inference.
- **Render Free Tier Constraint:** Max 512 MB RAM.
- **Outcome:** The OCR worker will immediately be killed by the Linux Out-Of-Memory (OOM) killer (`exit code 137`) during model loading or first scanned page processing.
- **Verdict:** **Scanned book OCR is NOT viable on 100% free hosting.** It requires either:
  1. A paid instance (Render Starter $7/mo with 1 GB RAM, or Railway $5+ tier with 2 GB RAM).
  2. Bypassing the OCR engine for scanned books and relying strictly on native digital text extraction (`NativeTextExtractor.js`), which runs inside Node.js on Render for free.

---

## 3. Free-Tier Limitations Matrix

| Resource | Free Tier Limit | Aks Production Requirement | Mitigation / Architecture Decision |
|---|---|---|---|
| **Render Web Service** | 512 MB RAM, sleeps after 15m | 200 MB for Node.js API; 1.4 GB for OCR | Split backend from OCR. Keep Node.js on Render; disable/defer OCR or host OCR separately. |
| **Render Local Disk** | Ephemeral (wiped on restart) | 100 MB – 50 GB user PDFs | Offload all PDF files and book covers to Cloudflare R2. |
| **Neon Storage** | 500 MB total database size | ~50 MB for 100 books text & search tokens | Store only text, tokens, and metadata in Neon. Never store base64 or file binaries in DB. |
| **Neon Compute** | Auto-suspends after 5m idle | Fast cold start (~1.5s wake-up) | Acceptable; Prisma handles reconnection automatically. |
| **Vercel Hobby** | 100 GB bandwidth, serverless limits | Static Vite bundle < 3 MB | Completely within Vercel free limits. |
| **Cloudflare R2** | 10 GB free, 0 egress cost | Typical user library: 2–5 GB | Easily accommodates hundreds of books within free 10 GB quota. |

---

## 4. Overall Feasibility Conclusion

1. **Digital PDF Reading, Journaling, Notes, Bookmarks & Search:** **100% Free and Feasible.**
2. **Scanned PDF Optical Character Recognition:** **Requires Paid RAM (> 1 GB) or local execution.**
3. **Prerequisite Code Changes:** An S3/R2 storage adapter must replace local `fs` calls, and Vercel proxy rewrites must be configured to prevent cookie rejection.

