-- Performance indexes found by the Epic-01 load test (apps/server/scripts/perf).
-- Hand-written (names/definitions match what `prisma migrate dev` would generate from schema.prisma).

-- Super Admin directory: ORDER BY "createdAt" DESC, "id" DESC LIMIT n (keyset pagination).
-- Unfiltered and role-only pages previously scanned + top-N-sorted every user.
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt" DESC, "id" DESC);
CREATE INDEX "User_role_createdAt_id_idx" ON "User"("role", "createdAt" DESC, "id" DESC);

-- Trainer roster: WHERE trainerId AND status = 'ACTIVE' ORDER BY "connectedAt" DESC, "id" DESC LIMIT n,
-- and the dashboard's connectedAt range counts. Replaces the (trainerId, status) prefix index.
CREATE INDEX "PlayerTrainerAssociation_trainerId_status_connectedAt_id_idx"
  ON "PlayerTrainerAssociation"("trainerId", "status", "connectedAt" DESC, "id" DESC);
DROP INDEX "PlayerTrainerAssociation_trainerId_status_idx";

-- Dashboard "impersonation sessions last 7 days" range counts.
CREATE INDEX "ImpersonationLog_startedAt_idx" ON "ImpersonationLog"("startedAt");
