-- Database/init.sql
-- Aks (अक्स) PostgreSQL Initialization Script

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Enable Trigram Extension (required for fast multilingual text & OCR search indexing)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 3. Verify installed extensions
DO $$
BEGIN
  RAISE NOTICE 'Extensions initialized successfully: uuid-ossp and pg_trgm';
END $$;
