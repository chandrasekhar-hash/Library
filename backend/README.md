# Aks (अक्स) — Backend API Service

Express 4 + Node.js REST API service for Aks, managing authentication, sessions, books, private file streaming, notes, bookmarks, and search orchestration.

## Features

- **Express & Prisma ORM**: Clean modular architecture with strict multi-tenant data isolation.
- **Session & Auth**: Secure HTTP-only cookies, argon2 password hashing, and session fixation protection.
- **Book & File Storage**: Private byte-range streaming (`/api/books/:bookId/file`) with zero public path leakage.
- **Multilingual Search**: Hybrid full-text, GIN trigram, and normalized Devanagari/English search.
- **Indexing Queue**: Automatic background indexing pipeline orchestrating native text extraction and Python OCR service.

## Environment Variables

Copy `.env.example` to `.env`:

```bash
PORT=5050
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aks_db?schema=public
SESSION_SECRET=your-secure-session-secret-at-least-32-chars
OCR_ENGINE_URL=http://localhost:5060
FRONTEND_URL=http://localhost:5173
TRUST_PROXY=false
```

## Running Locally

```bash
npm install
npx prisma generate
npm run dev
```

## Running via Docker

```bash
docker build -t aks-backend .
docker run -p 5050:5050 --env-file .env aks-backend
```
