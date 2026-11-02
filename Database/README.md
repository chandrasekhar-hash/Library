# Aks (अक्स) — Database

This folder contains the complete PostgreSQL database configuration, schema, migrations, and initialization scripts for Aks.

## Structure

```
Database/
├── prisma/
│   ├── migrations/       # Timestamped, versioned SQL migrations
│   └── schema.prisma     # Canonical Prisma data models & indices
├── docker-compose.yml    # Standalone PostgreSQL 16 Alpine container
├── init.sql              # Auto-loaded extensions (pg_trgm, uuid-ossp)
├── package.json          # Prisma CLI management scripts
├── .env.example          # Database connection template
└── README.md
```

## Prerequisites

- PostgreSQL 16+
- Mandatory Extension: `pg_trgm` (used for fast fuzzy, trigram, and multilingual OCR search)

## Quickstart with Docker

To spin up a local or production-ready PostgreSQL instance:

```bash
docker compose up -d
```

The database container will automatically run `init.sql` on startup to enable `uuid-ossp` and `pg_trgm`.

## Running Migrations

To apply all migrations to your PostgreSQL instance:

```bash
# From within the Database folder
npm install
npm run migrate:deploy

# Or using npx directly:
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

## Cloud Hosting Options

### 1. Supabase / Neon / Render / Railway
1. Create a new PostgreSQL database on your provider.
2. In the provider's SQL editor, run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pg_trgm";
   ```
3. Copy the pooled or direct `DATABASE_URL` connection string.
4. Run `npm run migrate:deploy` with your `DATABASE_URL` set.
