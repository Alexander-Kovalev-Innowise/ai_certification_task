import type { Role } from '@prisma/client';

// Task 2.2 (per the plan's task list), created early in Task 1.7 because the
// audit-stamp Prisma extension needs to read `AuthContext.impersonation`
// from ALS before JwtAuthGuard (Task 2.4) exists to publish one — the same
// "build it now, formalize later" ordering the plan uses for Task 1.6
// against TenantScope ahead of Task 1.8's interceptor. Reproduced verbatim
// from arch §7.2.
export interface AuthContext {
  userId: string; // effective
  role: Role; // effective
  accountType: 'ADULT' | 'CHILD';
  guardianUserId?: string;
  trainerId?: string; // tenant anchor; TRAINER & COACH only
  impersonation?: { actorUserId: string; actorRole: Role; logId: string; expiresAt: Date };
  auditActorId: string; // impersonation?.actorUserId ?? userId
}
