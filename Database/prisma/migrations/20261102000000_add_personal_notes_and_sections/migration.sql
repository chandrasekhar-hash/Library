-- AlterTable
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "sectionId" TEXT,
ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "journalDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "appearance" TEXT DEFAULT 'classic-paper',
ADD COLUMN IF NOT EXISTS "typography" JSONB,
ADD COLUMN IF NOT EXISTS "richContent" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "NoteSection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NoteSection_userId_name_key" ON "NoteSection"("userId", "name");
CREATE INDEX IF NOT EXISTS "NoteSection_userId_order_idx" ON "NoteSection"("userId", "order");
CREATE INDEX IF NOT EXISTS "Note_userId_isPinned_idx" ON "Note"("userId", "isPinned");
CREATE INDEX IF NOT EXISTS "Note_userId_sectionId_idx" ON "Note"("userId", "sectionId");
CREATE INDEX IF NOT EXISTS "Note_userId_journalDate_idx" ON "Note"("userId", "journalDate");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Note_sectionId_fkey') THEN
        ALTER TABLE "Note" ADD CONSTRAINT "Note_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "NoteSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NoteSection_userId_fkey') THEN
        ALTER TABLE "NoteSection" ADD CONSTRAINT "NoteSection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

