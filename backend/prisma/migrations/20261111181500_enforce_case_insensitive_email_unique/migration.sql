-- Enforce case-insensitive email uniqueness at the PostgreSQL database level
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_idx" ON "User" (LOWER(email));

