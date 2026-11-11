# Aks (अक्स) — Production Deployment & Environment Guide

This guide details the complete production environment configuration for deploying Aks across:
- **Frontend:** Vercel (React + Vite)
- **Backend:** Render (Node.js + Express)
- **Database:** Neon (Serverless PostgreSQL)
- **File Storage:** Cloudflare R2 (S3-compatible Object Storage)
- **OCR Engine:** Dedicated Python PaddleOCR Worker (or native PDF fallback)

---

## 1. Frontend Environment Configuration (Vercel)

Set these environment variables in the Vercel Project Settings (**Settings > Environment Variables**):

| Variable | Required | Example / Placeholder Value | Description |
| :--- | :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Optional | `https://aks-api.onrender.com` | Base URL pointing directly to the backend. Leave empty if using Vercel rewrites to proxy `/api/*`. |

### Vercel Routing Configuration
- For standard SPA routing, `frontend/vercel.json` rewrites all non-asset requests to `/index.html`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

> **Important Architectural Note on Vercel API Rewrites:**  
> While Vercel can proxy `/api/*` to Render, Vercel Edge proxies enforce a strict **4.5 MB request body limit** and a **10–30s execution timeout**. Because Aks supports PDF uploads up to 150 MB and video streaming with HTTP 206 Range requests, **Strategy A (Direct Subdomain / Direct Origin)** is strongly recommended for production (`VITE_API_BASE_URL=https://aks-api.onrender.com`).

---

## 2. Backend Environment Configuration (Render)

Configure these environment variables in the Render Dashboard (**Environment > Add Environment Variable**):

### General Server & Network
| Variable | Required | Example / Placeholder Value | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `production` | Enables production security headers, optimized logging, and secure cookies. |
| `PORT` | Yes | `10000` | Port assigned by Render (automatically bound by Express). |
| `FRONTEND_URL` | Yes | `https://aks-library.vercel.app` | Allowed CORS origins. Comma-separated list for multiple domains (e.g. `https://aks.vercel.app,https://aks-preview.vercel.app`). |
| `TRUST_PROXY` | Yes | `1` | Configures Express and express-session to trust Render's SSL termination load balancer. |

### Neon PostgreSQL Database
| Variable | Required | Example / Placeholder Value | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Yes | `postgresql://user:password@ep-pooler.us-east-2.aws.neon.tech/aks_db?sslmode=require&pgbouncer=true` | Pooled connection string using Neon's connection pooler for runtime app queries. |
| `DIRECT_URL` | Yes | `postgresql://user:password@ep-direct.us-east-2.aws.neon.tech/aks_db?sslmode=require` | Direct connection string for Prisma migrations (bypasses PgBouncer for session-level DDL locks). |

### Authentication & Cookies
| Variable | Required | Example / Placeholder Value | Description |
| :--- | :--- | :--- | :--- |
| `SESSION_SECRET` | Yes | *(Random 64+ char string)* | Cryptographically secure secret for HMAC signing session IDs. Generate with `openssl rand -hex 32`. |
| `COOKIE_SAME_SITE` | Yes | `lax` (or `none`) | Set to `lax` if frontend and backend share a common root domain or proxy. Set to `none` if frontend and backend are on completely distinct domains (`*.vercel.app` and `*.onrender.com`). |
| `COOKIE_SECURE` | Yes | `true` | Enforces `Secure` flag on cookies. Requires HTTPS. |
| `COOKIE_DOMAIN` | Optional | `.yourdomain.com` | Share cookies across subdomains (e.g. `app.yourdomain.com` and `api.yourdomain.com`). |

### Cloudflare R2 Object Storage
| Variable | Required | Example / Placeholder Value | Description |
| :--- | :--- | :--- | :--- |
| `STORAGE_PROVIDER` | Yes | `r2` | Enables Cloudflare R2 cloud storage provider. Set to `local` for local filesystem storage. |
| `R2_ACCOUNT_ID` | When `r2` | `a1b2c3d4e5f6g7h8i9j0` | Cloudflare account ID from the R2 dashboard. |
| `R2_ACCESS_KEY_ID` | When `r2` | *(S3 API Access Key ID)* | Generated under Cloudflare R2 > Manage R2 API Tokens. |
| `R2_SECRET_ACCESS_KEY` | When `r2` | *(S3 API Secret Access Key)* | Generated under Cloudflare R2 > Manage R2 API Tokens. |
| `R2_BUCKET_NAME` | When `r2` | `aks-storage-production` | Name of the R2 bucket. |
| `R2_ENDPOINT` | When `r2` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | S3-compatible R2 endpoint. |

### Multi-User Resource Protection & Quotas
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MAX_USER_STORAGE_BYTES` | Optional | `262144000` | Account storage quota (250 MB). Aggregates PDFs, user media assets, and book covers. |
| `MAX_PDF_SIZE_BYTES` | Optional | `157286400` | Maximum single PDF file upload size (150 MB). |
| `MAX_COVER_SIZE_BYTES` | Optional | `5242880` | Maximum cover thumbnail upload size (5 MB). |
| `MAX_ASSET_SIZE_BYTES` | Optional | `52428800` | Maximum custom media asset upload size (50 MB). |

### Rate Limits
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` | Optional | `900000` (15m) | Rate limiting window for file and media uploads. |
| `UPLOAD_RATE_LIMIT_MAX` | Optional | `30` | Maximum uploads per user per window. |
| `SEARCH_RATE_LIMIT_WINDOW_MS` | Optional | `60000` (1m) | Rate limiting window for book search queries. |
| `SEARCH_RATE_LIMIT_MAX` | Optional | `60` | Maximum search queries per user per minute. |
| `OCR_DISPATCH_RATE_LIMIT_WINDOW_MS` | Optional | `900000` (15m) | Rate limiting window for OCR dispatch and queue management. |
| `OCR_DISPATCH_RATE_LIMIT_MAX` | Optional | `20` | Maximum OCR job dispatch calls per user per window. |

### OCR Safeguards
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MAX_OCR_PAGE_COUNT` | Optional | `2000` | Maximum page count allowed for OCR processing. |
| `MAX_QUEUED_OCR_JOBS_PER_USER` | Optional | `10` | Maximum concurrent queued jobs per user account. |
| `OCR_MAX_CONCURRENT_JOBS` | Optional | `1` | Global concurrent OCR jobs across all users (protects worker RAM). |
| `OCR_WORKER_URL` | Optional | `http://127.0.0.1:5060` | Loopback or private network URL for the Python OCR service. |
| `OCR_WORKER_TOKEN` | Optional | `aks-internal-dev-token` | Bearer token for inter-service authentication. |

---

## 3. Neon Database Setup & Migration Instructions

1. **Create Database in Neon Console**:
   - Create a project named `aks-production` in your preferred region.
   - Note the **Pooled connection string** (ends with `-pooler...`) and the **Direct connection string** (without `-pooler`).
2. **Apply Migrations Safely**:
   - To run Prisma migrations against Neon during deployment, supply the direct URL:
     ```bash
     DIRECT_URL="<NEON_DIRECT_URL>" DATABASE_URL="<NEON_POOLED_URL>" npx prisma migrate deploy --schema=backend/prisma/schema.prisma
     ```
   - All migrations, including `20261029070000_add_pg_trgm_and_trigram_index` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`), are fully supported by Neon.
3. **No Migration Lock Conflicts**:
   - Running `prisma migrate deploy` applies existing migration files sequentially without generating new migration diffs.

---

## 4. Cloudflare R2 Bucket Configuration

1. **Create Bucket**:
   - In Cloudflare Dashboard > R2 > Create bucket named `aks-storage-production`.
2. **CORS Policy (Optional if proxied by backend)**:
   - Since all PDFs and assets in Aks are streamed through authenticated Express endpoints (`/api/books/:id/file`), the R2 bucket remains completely private and does not need public read permissions.
3. **API Token**:
   - Create an API token with **Object Read & Write** permissions scoped to the `aks-storage-production` bucket.

---

## 5. Security Checklist Before Launch

- [ ] `SESSION_SECRET` is set to a cryptographically secure random string of $\ge 32$ characters.
- [ ] `COOKIE_SECURE=true` is set.
- [ ] `COOKIE_SAME_SITE` is set to `lax` (if using shared subdomain) or `none` (if cross-domain).
- [ ] `TRUST_PROXY=1` is set on Render so Express detects HTTPS properly.
- [ ] `FRONTEND_URL` matches the production Vercel domain exactly (without trailing slash).
- [ ] All database queries remain scoped to `userId` (verified by multi-user test suites).
- [ ] No database passwords or API keys are committed to Git.
