# Aks (अक्स) — A Reflection of You

Aks (अक्स) is a privacy-first, serene reading sanctuary and personal PDF library application featuring local guest mode, account-based cloud synchronization, and private document storage.

---

## Project Structure

```text
Aks/
│
├── frontend/                     # React 19 + Vite Frontend SPA
│   ├── public/                   # Static assets, icons, fonts & videos
│   ├── src/                      # React components, pages, services & styles
│   │   ├── components/           # UI components (auth, reader, sanctuary, etc.)
│   │   ├── pages/                # Main application screens
│   │   ├── services/             # IndexedDB, API clients, preferences, migration
│   │   ├── styles/               # CSS stylesheets & theme tokens
│   │   └── ...
│   ├── index.html                # Single Page Application entrypoint
│   ├── package.json              # Frontend scripts & dependencies
│   ├── vite.config.js            # Vite build & development proxy configuration
│   └── .env.example              # Frontend environment variables template
│
├── backend/                      # Node.js + Express + Prisma Backend Service
│   ├── src/                      # Express application source
│   │   ├── config/               # Environment, database, and storage configs
│   │   ├── controllers/          # Book, annotation, auth, and preference controllers
│   │   ├── middleware/           # Session, CSRF, rate-limiting & auth guards
│   │   ├── routes/               # Modular Express API routes
│   │   ├── services/             # Prisma client & private storage service
│   │   └── ...
│   ├── prisma/                   # Prisma schema & PostgreSQL migration history
│   │   ├── schema.prisma         # Data models and compound indexes
│   │   └── migrations/           # Version-controlled SQL migration scripts
│   ├── test/                     # Comprehensive Node.js native test suites
│   ├── storage/                  # Private file storage (PDFs, backgrounds, temp)
│   ├── package.json              # Backend scripts & dependencies
│   └── .env.example              # Backend environment variables template
│
├── scripts/                      # Orchestration & developer scripts
│   └── dev.mjs                   # Unified concurrent dev server runner
│
├── .gitignore                    # Root Git ignore rules (secrets & assets protected)
├── package.json                  # Root orchestration scripts
└── README.md                     # Project documentation
```

---

## Quick Start

### 1. Prerequisites
- **Node.js**: v20 or higher
- **PostgreSQL**: v14 or higher running on `localhost:5432` with database `aks_db`

### 2. Environment Setup
Copy the example environment files:

```bash
# In backend/
cp backend/.env.example backend/.env

# In frontend/
cp frontend/.env.example frontend/.env
```

Ensure `DATABASE_URL` in `backend/.env` points to your PostgreSQL instance:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/aks_db?schema=public"
```

### 3. Install Dependencies

You can install all dependencies across both packages from the project root:
```bash
npm run install:all
```

Or independently:
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4. Database Setup & Migrations

Deploy database migrations to your PostgreSQL instance:
```bash
npm run prisma:migrate:deploy
```

Generate the Prisma Client:
```bash
npm run prisma:generate
```

---

## Running the Application

### Start Both Frontend & Backend Concurrently
From the project root:
```bash
npm run dev
```

This launches:
- **Backend API**: `http://localhost:5050`
- **Frontend App**: `http://localhost:5173`

### Start Independently
```bash
# Backend only
npm run dev:backend

# Frontend only
npm run dev:frontend
```

---

## Verification & Testing

### Run Backend Test Suite
```bash
npm test
# or
npm run test:backend
```

### Build Frontend for Production
```bash
npm run build
# or
npm run build:frontend
```

### Prisma Studio
To inspect database records visually:
```bash
npm run prisma:studio
```
