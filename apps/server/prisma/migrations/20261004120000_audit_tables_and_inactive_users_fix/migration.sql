-- Additive only. Epic-01 audit follow-ups.

-- CreateTable
CREATE TABLE "audit"."ImpersonationAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "effectiveUserId" TEXT NOT NULL,
    "impersonationLogId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."TrainerCreationLog" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "trainerUserId" TEXT NOT NULL,
    "trainerProfileId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerCreationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationAuditLog_impersonationLogId_idx" ON "audit"."ImpersonationAuditLog"("impersonationLogId");

-- audit grants: same write-only posture as UserDeletionLog (INSERT only for the
-- app role; see the init migration's caveat about superuser roles). SELECT is
-- additionally granted where the app exposes a read-only view of the trail:
--   * UserDeletionLog     -> GET /users/deletion-log
--   * ImpersonationAuditLog -> write-count column in GET /impersonation/history
-- UPDATE/DELETE stay denied everywhere in `audit`.
GRANT INSERT ON audit."ImpersonationAuditLog" TO CURRENT_USER;
GRANT INSERT ON audit."TrainerCreationLog" TO CURRENT_USER;
REVOKE UPDATE, DELETE ON audit."ImpersonationAuditLog" FROM CURRENT_USER;
REVOKE UPDATE, DELETE ON audit."TrainerCreationLog" FROM CURRENT_USER;
GRANT SELECT ON audit."UserDeletionLog" TO CURRENT_USER;
GRANT SELECT ON audit."ImpersonationAuditLog" TO CURRENT_USER;

-- Deactivation no longer uses the soft-delete column: INACTIVE is expressed by
-- status alone, only GDPR delete sets deletedAt. Heal rows written by the old
-- deactivate() so they show in the directory / produce ACCOUNT_INACTIVE on login.
UPDATE "User" SET "deletedAt" = NULL WHERE "status" = 'INACTIVE' AND "deletedAt" IS NOT NULL;
