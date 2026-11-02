-- AlterTable
ALTER TABLE "Book" ADD COLUMN "sourceId" TEXT;

-- AlterTable
ALTER TABLE "Bookmark" ADD COLUMN "sourceId" TEXT;

-- AlterTable
ALTER TABLE "Highlight" ADD COLUMN "sourceId" TEXT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "sourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Book_sourceId_userId_key" ON "Book"("sourceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_sourceId_userId_key" ON "Bookmark"("sourceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Highlight_sourceId_userId_key" ON "Highlight"("sourceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_sourceId_userId_key" ON "Note"("sourceId", "userId");
