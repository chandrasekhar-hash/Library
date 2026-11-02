-- DropForeignKey
ALTER TABLE "BookFile" DROP CONSTRAINT "BookFile_bookId_fkey";

-- DropForeignKey
ALTER TABLE "BookPreference" DROP CONSTRAINT "BookPreference_bookId_fkey";

-- DropForeignKey
ALTER TABLE "Bookmark" DROP CONSTRAINT "Bookmark_bookId_fkey";

-- DropForeignKey
ALTER TABLE "Highlight" DROP CONSTRAINT "Highlight_bookId_fkey";

-- DropForeignKey
ALTER TABLE "ReadingProgress" DROP CONSTRAINT "ReadingProgress_bookId_fkey";

-- DropIndex
DROP INDEX "BookPreference_userId_bookId_key";

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "bookTitleSnapshot" TEXT;

-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "studyTimeResetAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Book_id_userId_key" ON "Book"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BookFile_bookId_userId_key" ON "BookFile"("bookId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BookPreference_bookId_userId_key" ON "BookPreference"("bookId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingProgress_bookId_userId_key" ON "ReadingProgress"("bookId", "userId");

-- AddForeignKey
ALTER TABLE "BookFile" ADD CONSTRAINT "BookFile_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingProgress" ADD CONSTRAINT "ReadingProgress_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookPreference" ADD CONSTRAINT "BookPreference_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
