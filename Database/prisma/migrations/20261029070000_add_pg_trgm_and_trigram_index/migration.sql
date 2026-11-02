-- Enable pg_trgm extension for fast trigram fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN Trigram index on rawText for fast ILIKE and fuzzy similarity queries
CREATE INDEX IF NOT EXISTS "BookPageOcr_rawText_trgm_idx" ON "BookPageOcr" USING GIN ("rawText" gin_trgm_ops);

