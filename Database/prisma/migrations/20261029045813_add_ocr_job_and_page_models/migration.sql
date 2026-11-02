-- CreateEnum
CREATE TYPE "OcrJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OcrPageSource" AS ENUM ('NATIVE', 'OCR');

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL DEFAULT 'en',
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "processedPages" INTEGER NOT NULL DEFAULT 0,
    "failedPages" INTEGER NOT NULL DEFAULT 0,
    "nativePages" INTEGER NOT NULL DEFAULT 0,
    "ocrPages" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookPageOcr" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "source" "OcrPageSource" NOT NULL DEFAULT 'OCR',
    "rawText" TEXT NOT NULL,
    "searchTokens" TEXT[],
    "normalizerVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "language" TEXT NOT NULL DEFAULT 'en',
    "confidence" DOUBLE PRECISION,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "detectedRotation" INTEGER NOT NULL DEFAULT 0,
    "bboxData" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookPageOcr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrJob_userId_status_idx" ON "OcrJob"("userId", "status");

-- CreateIndex
CREATE INDEX "OcrJob_bookId_status_idx" ON "OcrJob"("bookId", "status");

-- CreateIndex
CREATE INDEX "OcrJob_status_createdAt_idx" ON "OcrJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OcrJob_userId_idempotencyKey_key" ON "OcrJob"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BookPageOcr_userId_idx" ON "BookPageOcr"("userId");

-- CreateIndex
CREATE INDEX "BookPageOcr_bookId_pageNumber_idx" ON "BookPageOcr"("bookId", "pageNumber");

-- CreateIndex
CREATE INDEX "BookPageOcr_bookId_language_idx" ON "BookPageOcr"("bookId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "BookPageOcr_bookId_pageNumber_userId_key" ON "BookPageOcr"("bookId", "pageNumber", "userId");

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookPageOcr" ADD CONSTRAINT "BookPageOcr_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookPageOcr" ADD CONSTRAINT "BookPageOcr_bookId_userId_fkey" FOREIGN KEY ("bookId", "userId") REFERENCES "Book"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
