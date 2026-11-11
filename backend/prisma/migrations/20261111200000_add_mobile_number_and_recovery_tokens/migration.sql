-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mobileNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_mobileNumber_key" ON "User"("mobileNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_mobileNumber_idx" ON "User"("mobileNumber");

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordRecoveryToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordRecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordRecoveryToken_tokenHash_key" ON "PasswordRecoveryToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordRecoveryToken_userId_idx" ON "PasswordRecoveryToken"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordRecoveryToken_expiresAt_idx" ON "PasswordRecoveryToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordRecoveryToken" DROP CONSTRAINT IF EXISTS "PasswordRecoveryToken_userId_fkey";
ALTER TABLE "PasswordRecoveryToken" ADD CONSTRAINT "PasswordRecoveryToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

