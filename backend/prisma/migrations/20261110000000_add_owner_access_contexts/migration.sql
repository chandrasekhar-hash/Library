-- CreateEnum
CREATE TYPE "OwnerAccessStatus" AS ENUM ('ACTIVE', 'EXITED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "OwnerAccessContext" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "ownerSessionId" TEXT NOT NULL,
    "status" "OwnerAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "revocationReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerAccessContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerAccessContext_ownerId_idx" ON "OwnerAccessContext"("ownerId");

-- CreateIndex
CREATE INDEX "OwnerAccessContext_targetUserId_idx" ON "OwnerAccessContext"("targetUserId");

-- CreateIndex
CREATE INDEX "OwnerAccessContext_ownerSessionId_idx" ON "OwnerAccessContext"("ownerSessionId");

-- CreateIndex
CREATE INDEX "OwnerAccessContext_relationshipId_idx" ON "OwnerAccessContext"("relationshipId");

-- CreateIndex
CREATE INDEX "OwnerAccessContext_status_idx" ON "OwnerAccessContext"("status");

-- CreateIndex
CREATE INDEX "OwnerAccessContext_ownerId_status_idx" ON "OwnerAccessContext"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "OwnerAccessContext" ADD CONSTRAINT "OwnerAccessContext_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAccessContext" ADD CONSTRAINT "OwnerAccessContext_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAccessContext" ADD CONSTRAINT "OwnerAccessContext_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "AccountRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

