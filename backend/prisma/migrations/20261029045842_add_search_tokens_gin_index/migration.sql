-- Create GIN Index for fast multilingual search token lookups
CREATE INDEX "BookPageOcr_searchTokens_gin_idx" ON "BookPageOcr" USING GIN ("searchTokens");
