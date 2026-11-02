-- AlterTable
ALTER TABLE "ReadingSession" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReadingSession_userId_idempotencyKey_key" ON "ReadingSession"("userId", "idempotencyKey");
