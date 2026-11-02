# Aks (अक्स) — A Reflection of You

> A private, aesthetic reading sanctuary, personal journal workspace, and intelligent multilingual library.

```
                  _   _    _  ____  
                 / \ | | _| |/ ___| 
                / _ \| |/ / |\___ \ 
               / ___ \   <  | |___) |
              /_/   \_\_|\_\_||____/ 
                                     
```

---

## 🏛 Project Architecture (4 Modular Folders)

Aks is divided cleanly into 4 modular, independently deployable tiers:

```
Library/
├── frontend/        # React 19 + Vite web client & reading interface
├── backend/         # Express 4 + Node.js REST API & storage streaming
├── Database/        # PostgreSQL Prisma schema, migrations & init scripts
├── ocr-engine/      # Python FastAPI + PyMuPDF + PaddleOCR microservice
├── docs/            # Architecture specifications & audit reports
└── docker-compose.yml # 1-command deployment orchestrator
```

### 1. `frontend/` (Web Application)
- **Tech**: React 19, Vite, PDF.js, TipTap ProseMirror, Lucide Icons.
- **Role**: Responsive reading room (desktop two-page spreads, mobile single-page view), personal journal canvas, typography controls, and transient search highlighting.
- **Port**: `5173` (dev) / `80` (production Docker).

### 2. `backend/` (Core API Server)
- **Tech**: Node.js, Express, Prisma ORM, Argon2, Busboy.
- **Role**: User authentication, session security, private PDF streaming (`GET /api/books/:id/file`), bookmarks, highlights, personal notes CRUD, and search orchestration.
- **Port**: `5050`.

### 3. `Database/` (Data Store & Migrations)
- **Tech**: PostgreSQL 16 Alpine, Prisma Migrations, `pg_trgm` & `uuid-ossp` extensions.
- **Role**: Relational schema, multi-tenant isolation, GIN trigram indexing for ultra-fast full-text search.
- **Port**: `5432`.

### 4. `ocr-engine/` (Multilingual Extraction Service)
- **Tech**: Python 3.11, FastAPI, PyMuPDF (fitz), PaddleOCR, Devanagari normalizer.
- **Role**: High-fidelity OCR for scanned books, Devanagari conjuncts, and Sanskrit text with word-level bounding box coordinates.
- **Port**: `5060`.

---

## 🚀 1-Command Production Deployment (Docker Compose)

Host the complete application with all 4 services networked and initialized:

```bash
docker compose up -d --build
```

Access the services:
- **Frontend App**: `http://localhost:80`
- **Backend API**: `http://localhost:5050/api/health`
- **OCR Engine**: `http://localhost:5060/health`
- **PostgreSQL**: `localhost:5432`

---

## 💻 Local Development Setup

### 1. Database
```bash
# Start PostgreSQL via Docker or local service
cd Database
docker compose up -d
npm install
npm run migrate:deploy
cd ..
```

### 2. Backend
```bash
cd backend
npm install
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. OCR Engine (Optional for scanned books)
```bash
cd ocr-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.api:app --host 127.0.0.1 --port 5060
```

---

## ☁️ Cloud Hosting Guides

| Service | Recommended Hosting Platform | How to Deploy |
|---|---|---|
| **frontend** | Vercel / Netlify / Cloudflare Pages / Railway | Set root directory to `frontend`, build command `npm run build`, output directory `dist` |
| **backend** | Railway / Render / Fly.io / AWS ECS | Set root directory to `backend`, run `npm start` |
| **Database** | Supabase / Neon / AWS RDS / Railway Postgres | Run `Database/init.sql` to enable `pg_trgm`, set `DATABASE_URL` |
| **ocr-engine** | Fly.io / GCP Cloud Run / Railway (Docker) | Deploy via `ocr-engine/Dockerfile` |

---

## 📄 License & Documentation
For detailed architecture reports and audit logs, see the [`docs/`](./docs) directory.
