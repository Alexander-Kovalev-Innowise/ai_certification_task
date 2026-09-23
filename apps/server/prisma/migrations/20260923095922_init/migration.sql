-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "CoachStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "AssociationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ShareLinkType" AS ENUM ('PLAYER_STATIC', 'COACH_UNIQUE');

-- CreateEnum
CREATE TYPE "ShareLinkStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AvailabilitySubjectType" AS ENUM ('PLAYER', 'COACH');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ELITE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('USD', 'TOKEN');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "photoUrl" TEXT,
    "notificationPrefs" JSONB,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "address" TEXT,
    "website" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "primaryColorHex" TEXT,
    "derivedPaletteJson" JSONB,
    "stripeCustomerId" TEXT,
    "subscriptionStatus" TEXT,
    "platformFeePercent" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "bio" TEXT,
    "credentials" TEXT,
    "certifications" TEXT,
    "publicProfile" BOOLEAN NOT NULL DEFAULT false,
    "status" "CoachStatus" NOT NULL DEFAULT 'PENDING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "accountUserId" TEXT NOT NULL,
    "childUserId" TEXT,
    "name" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" "Gender" NOT NULL,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'BEGINNER',
    "school" TEXT,
    "jerseyNumber" TEXT,
    "photoUrl" TEXT,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "allowChildTokenSpendWithoutApproval" BOOLEAN NOT NULL DEFAULT false,
    "emergencyContact" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerTrainerAssociation" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "playerProfileId" TEXT NOT NULL,
    "shareLinkId" TEXT,
    "status" "AssociationStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "PlayerTrainerAssociation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ShareLinkType" NOT NULL,
    "trainerId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "targetEmail" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ShareLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "subjectType" "AvailabilitySubjectType" NOT NULL,
    "playerProfileId" TEXT,
    "coachProfileId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" INTEGER NOT NULL,
    "endTime" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachAvailabilityOverride" (
    "id" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "coachId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachAvailabilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildPurchaseApproval" (
    "id" TEXT NOT NULL,
    "playerProfileId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "parentNotes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildPurchaseApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."UserDeletionLog" (
    "id" TEXT NOT NULL,
    "originalUserId" TEXT NOT NULL,
    "originalEmail" TEXT NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataBackupJson" JSONB NOT NULL,

    CONSTRAINT "UserDeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_role_createdAt_idx" ON "User"("status", "role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerProfile_userId_key" ON "TrainerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_key" ON "CoachProfile"("userId");

-- CreateIndex
CREATE INDEX "CoachProfile_trainerId_status_idx" ON "CoachProfile"("trainerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_childUserId_key" ON "PlayerProfile"("childUserId");

-- CreateIndex
CREATE INDEX "PlayerProfile_accountUserId_idx" ON "PlayerProfile"("accountUserId");

-- CreateIndex
CREATE INDEX "PlayerTrainerAssociation_trainerId_status_idx" ON "PlayerTrainerAssociation"("trainerId", "status");

-- CreateIndex
CREATE INDEX "PlayerTrainerAssociation_playerProfileId_status_idx" ON "PlayerTrainerAssociation"("playerProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerTrainerAssociation_trainerId_playerProfileId_key" ON "PlayerTrainerAssociation"("trainerId", "playerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_code_key" ON "ShareLink"("code");

-- CreateIndex
CREATE INDEX "ShareLink_trainerId_status_idx" ON "ShareLink"("trainerId", "status");

-- CreateIndex
CREATE INDEX "Availability_playerProfileId_dayOfWeek_idx" ON "Availability"("playerProfileId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Availability_coachProfileId_dayOfWeek_idx" ON "Availability"("coachProfileId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "CoachAvailabilityOverride_eventId_idx" ON "CoachAvailabilityOverride"("eventId");

-- CreateIndex
CREATE INDEX "ImpersonationLog_adminUserId_idx" ON "ImpersonationLog"("adminUserId");

-- CreateIndex
CREATE INDEX "ImpersonationLog_targetUserId_idx" ON "ImpersonationLog"("targetUserId");

-- CreateIndex
CREATE INDEX "ChildPurchaseApproval_parentUserId_status_idx" ON "ChildPurchaseApproval"("parentUserId", "status");

-- CreateIndex
CREATE INDEX "ChildPurchaseApproval_status_expiresAt_idx" ON "ChildPurchaseApproval"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OutboxJob_status_nextAttemptAt_idx" ON "OutboxJob"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "TrainerProfile" ADD CONSTRAINT "TrainerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_accountUserId_fkey" FOREIGN KEY ("accountUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_childUserId_fkey" FOREIGN KEY ("childUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTrainerAssociation" ADD CONSTRAINT "PlayerTrainerAssociation_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTrainerAssociation" ADD CONSTRAINT "PlayerTrainerAssociation_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTrainerAssociation" ADD CONSTRAINT "PlayerTrainerAssociation_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAvailabilityOverride" ADD CONSTRAINT "CoachAvailabilityOverride_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "CoachProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAvailabilityOverride" ADD CONSTRAINT "CoachAvailabilityOverride_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildPurchaseApproval" ADD CONSTRAINT "ChildPurchaseApproval_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildPurchaseApproval" ADD CONSTRAINT "ChildPurchaseApproval_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."UserDeletionLog" ADD CONSTRAINT "UserDeletionLog_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- pg_trgm for directory search (NFR-002)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "user_email_trgm_idx" ON "User" USING gin (lower(email) gin_trgm_ops);
CREATE INDEX "user_name_trgm_idx" ON "User" USING gin ((lower("firstName") || ' ' || lower("lastName")) gin_trgm_ops);

-- BR-003: exactly one ACTIVE trainer per coach
CREATE UNIQUE INDEX "coach_profile_one_active_trainer" ON "CoachProfile" ("userId") WHERE status = 'ACTIVE';

-- BR-001 (§3.2): a User cannot simultaneously hold a TrainerProfile and a CoachProfile
CREATE OR REPLACE FUNCTION assert_single_profile_kind() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'TrainerProfile' AND EXISTS (SELECT 1 FROM "CoachProfile" WHERE "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'User % already has a CoachProfile', NEW."userId";
  END IF;
  IF TG_TABLE_NAME = 'CoachProfile' AND EXISTS (SELECT 1 FROM "TrainerProfile" WHERE "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'User % already has a TrainerProfile', NEW."userId";
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_trainer_single_role AFTER INSERT ON "TrainerProfile" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_single_profile_kind();
CREATE CONSTRAINT TRIGGER trg_coach_single_role AFTER INSERT ON "CoachProfile" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_single_profile_kind();

-- Availability exclusive arc: exactly one of playerProfileId/coachProfileId, agreeing with subjectType
-- NOTE: plan's original SQL left `subjectType` unquoted, which Postgres folds to
-- lowercase `subjecttype` and fails to resolve (the column is camelCase, created
-- quoted by Prisma like every other identifier here) — quoted below to fix it.
ALTER TABLE "Availability" ADD CONSTRAINT "availability_exclusive_arc" CHECK (
  ("subjectType" = 'PLAYER' AND "playerProfileId" IS NOT NULL AND "coachProfileId" IS NULL) OR
  ("subjectType" = 'COACH' AND "coachProfileId" IS NOT NULL AND "playerProfileId" IS NULL)
);

-- §11.1: status = DELETED implies deletedAt IS NOT NULL (irreversibility is structural)
ALTER TABLE "User" ADD CONSTRAINT "user_deleted_has_timestamp" CHECK (status != 'DELETED' OR "deletedAt" IS NOT NULL);

-- audit schema: write-only grants (§11.2) — the app's normal role can INSERT but never SELECT/UPDATE/DELETE
--
-- CAVEAT (flagged for product/infra sign-off, not fixable inside this migration):
-- this REVOKE is a no-op when CURRENT_USER is a PostgreSQL superuser, because
-- superusers bypass all privilege checks including REVOKE. The dev docker-compose
-- role (`postgres`, set in the root .env's DATABASE_URL, Task 0.7) *is* the
-- default Postgres superuser, so in this environment the write-only guarantee
-- is structurally correct but not yet enforced end-to-end. Closing this requires
-- provisioning a non-superuser application role and pointing DATABASE_URL at it
-- (out of scope for Task 1.2 — .env is owner-managed, not edited by this task).
-- The migration.e2e-spec.ts test below proves the GRANT/REVOKE mechanism itself
-- is correct by exercising it against a dedicated non-superuser role it creates.
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO CURRENT_USER;
GRANT INSERT ON audit."UserDeletionLog" TO CURRENT_USER;
REVOKE SELECT, UPDATE, DELETE ON audit."UserDeletionLog" FROM CURRENT_USER;
