-- Additive only. Epic-01 gap closure: coach "request change" on an availability override
-- (US-01.10) + per-user read-state for the derived in-app notifications (US-01.05).

-- AlterTable
ALTER TABLE "CoachAvailabilityOverride" ADD COLUMN "changeRequestedAt" TIMESTAMP(3),
ADD COLUMN "changeRequestMessage" TEXT;

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationRead_readAt_idx" ON "NotificationRead"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_userId_itemKey_key" ON "NotificationRead"("userId", "itemKey");

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
