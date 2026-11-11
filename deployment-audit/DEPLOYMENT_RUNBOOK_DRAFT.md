# Aks (अक्स) — Public Cloud Deployment Runbook Draft

**Audit Date:** November 2, 2026  
**Document Status:** DRAFT FOR REVIEW (DO NOT EXECUTE WITHOUT APPROVAL)  
**Notice:** All production commands below are marked as `[UNVERIFIED - TEST IN STAGING FIRST]` per the audit safety policy.

---

## 1. Deployment Readiness Scorecard

| Component | Current Implementation | Free-Tier Compatibility | Required Work Before Public Launch | Risk Level |
|---|---|---|---|---|
| **Frontend UI** | React 19 + Vite SPA | **High (Vercel)** | Add `frontend/vercel.json` rewrites for `/api/*` | Low |
| **Backend API** | Node.js 20 Express | **Medium (Render)** | Configure `TRUST_PROXY=true`, handle cold starts | Low |
| **Authentication** | Argon2 + Express-Session | **High** | Working as designed; requires same-origin proxy | Low |
| **Session Cookies** | HttpOnly, Lax, Secure in prod | **High** | Works seamlessly when proxied through Vercel | Low |
| **CSRF Protection** | Timing-safe tokens in session | **High** | Works with same-origin `/api` proxy | Low |
| **Database** | PostgreSQL 16 (Local) | **High (Neon)** | Create Neon project, enable `pg_trgm` | Low |
| **Prisma Migrations** | 8 versioned SQL migrations | **High (Neon)** | Run against Neon direct (unpooled) connection | Low |
| **PDF File Storage** | Local POSIX disk (`fs`) | **NONE (Ephemeral)** | **Refactor to Cloudflare R2 S3 SDK** | **Critical** |
| **PDF Streaming** | Local byte-range `fs` stream | **NONE (Ephemeral)** | **Stream range requests from Cloudflare R2** | **Critical** |
| **Scanned OCR Worker**| Python FastAPI + PaddleOCR | **NONE (> 1.2 GB RAM)** | **Disable for free tier or host on paid RAM** | **High** |
| **Native Text Search** | `pdfjs-dist` in Node.js | **High (Render)** | Works within 512 MB RAM | Low |
| **Personal Journal** | TipTap ProseMirror + Neon | **High** | Works natively with PostgreSQL JSONB | Low |
| **PWA / ServiceWorker**| None (PDF worker only) | **N/A** | Add `manifest.json` if offline caching needed | Low |
| **Email Verification** | Missing | **Not Supported Yet** | Add email token schema + Resend/SendGrid API | **High** |
| **Password Reset** | Missing | **Not Supported Yet** | Add reset token schema + reset UI/API | **High** |
| **Storage Quotas** | Missing (150 MB/file only) | **High Abuse Risk** | Enforce per-user total storage cap in code | **High** |
| **Public Registration** | Implemented with rate limit | **Medium** | Add CAPTCHA or email confirmation | Medium |
| **Backups** | None automated | **High (Neon auto-backup)**| Enable automated Neon point-in-time recovery | Medium |

---

## 2. Environment Variables Specification (Names Only — Zero Secrets)

### 2.1 Backend Environment (`backend/.env`)
```bash
# Server Networking
PORT
NODE_ENV
TRUST_PROXY
FRONTEND_URL

# Database Connections (Neon)
DATABASE_URL            # Pooled connection URL (pgbouncer)
DIRECT_URL              # Direct unpooled connection URL (for migrations)

# Session Security
SESSION_SECRET          # Minimum 32-character random string
SESSION_COOKIE_NAME

# Cloudflare R2 Storage (Required after R2 adapter integration)
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_DOMAIN        # Optional: if using public CDN

# OCR Integration (Optional / Conditional)
OCR_WORKER_URL
OCR_WORKER_TOKEN
OCR_WORKER_TIMEOUT_MS
```

### 2.2 Frontend Environment (`frontend/.env`)
```bash
# API Base URL (Leave blank to use Vercel same-origin /api rewrite)
VITE_API_BASE_URL
```

---

## 3. Step-by-Step Deployment Sequence

### Step 1: Database Setup (Neon PostgreSQL)
1. Create a clean project in Neon.
2. In the Neon SQL console, execute:
   ```sql
   -- [UNVERIFIED - TEST IN STAGING FIRST]
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pg_trgm";
   ```
3. Retrieve both the **Pooled Connection String** and **Direct Connection String**.

### Step 2: Apply Prisma Migrations to Neon
From a staging machine or local development environment:
```bash
# [UNVERIFIED - TEST IN STAGING FIRST]
export DATABASE_URL="<NEON_DIRECT_UNPOOLED_CONNECTION_STRING>"
npx prisma migrate deploy --schema=./backend/prisma/schema.prisma
```
*Verification Check:* Ensure all 8 migrations apply cleanly without errors.

### Step 3: Deploy Backend Web Service (Render)
1. Connect GitHub repository to Render.
2. Select **Web Service** with runtime `Node`.
3. Configure settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npx prisma generate`
   - **Start Command:** `npm start`
   - **Auto-Deploy:** On branch `main`
4. Add all environment variables listed in Section 2.1 above.
5. Deploy and verify health check: `GET https://<your-render-service>.onrender.com/api/health`.

### Step 4: Deploy Frontend (Vercel)
1. Connect GitHub repository to Vercel.
2. Configure settings:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Configure `frontend/vercel.json` rewrite:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://<your-render-service>.onrender.com/api/:path*"
       }
     ]
   }
   ```
4. Deploy and verify browser access at `https://<your-project>.vercel.app`.

---

## 4. Rollback & Disaster Recovery Procedures

### 4.1 Frontend Rollback (Instant)
In the Vercel Dashboard, select **Deployments**, locate the last known healthy deployment, and click **Promote to Production** (takes < 5 seconds).

### 4.2 Backend Rollback
In the Render Dashboard, select **Deploys**, click on the previous successful deploy commit, and select **Rollback to this deploy**.

### 4.3 Database Backup & Recovery (Neon)
1. **Automated Point-in-Time Restore (PITR):** Neon natively supports instant branching and point-in-time rollback. In the Neon console, create a restore branch from the timestamp prior to the incident.
2. **Manual Dump:**
   ```bash
   # [UNVERIFIED - TEST IN STAGING FIRST]
   pg_dump "<DATABASE_URL>" -Fc -f aks_backup_$(date +%Y%m%d_%H%M%S).dump
   ```
3. **Manual Restore:**
   ```bash
   # [UNVERIFIED - TEST IN STAGING FIRST]
   pg_restore --clean --if-exists -d "<DATABASE_URL>" aks_backup.dump
   ```

