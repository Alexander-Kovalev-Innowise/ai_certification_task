-- Additive only. Epic-01 audit: trainer removes a coach from their organisation
-- (CoachStatus.INACTIVE, history kept) + coach acknowledgement of an availability override.

-- AlterEnum
ALTER TYPE "CoachStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "CoachAvailabilityOverride" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
