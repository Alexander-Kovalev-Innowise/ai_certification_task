import { Prisma } from '@prisma/client';

import { getTenantScope } from '../../tenancy/tenant-context.store';
import { TenantScopeViolationError } from '../../tenancy/tenant-scope-violation.error';

// Task 1.6 (arch §8 Layer 2 — "runtime net"). Wraps $allOperations for the
// declared tenant-owned model set: TrainerProfile, CoachProfile,
// PlayerTrainerAssociation, ShareLink, CoachAvailabilityOverride. If the ALS
// TenantScope is TRAINER and the query's `where` doesn't carry the matching
// tenant-owning id, this throws TenantScopeViolationError — it never
// silently injects the filter (arch §8's deliberate choice: a missing scope
// should be a loud bug, not a confusing empty result).
//
// PLATFORM scope and an *absent* scope both skip the check without
// throwing. The absent-scope case matters structurally: this extension can
// run before TenantContextInterceptor (Task 1.8) ever publishes anything to
// ALS — e.g. JwtAuthGuard's own `User` read (Task 2.4) happens at guard
// step 5, before the interceptor at step 8 — and `User` isn't even in this
// tenant-owned set, so there are two independent reasons that read is safe.
//
// Deviation/clarification from the plan's literal wording ("the query's
// where does not contain a trainerId"): TrainerProfile has no `trainerId`
// column — it has `id`, since a TrainerProfile row *is* the tenant, not a
// child of one. TENANT_ID_FIELD_BY_MODEL below maps each of the five models
// to the field that actually carries the tenant-owning trainer's id.
const TENANT_ID_FIELD_BY_MODEL = {
  TrainerProfile: 'id',
  CoachProfile: 'trainerId',
  PlayerTrainerAssociation: 'trainerId',
  ShareLink: 'trainerId',
  CoachAvailabilityOverride: 'trainerId',
} as const;

type TenantOwnedModel = keyof typeof TENANT_ID_FIELD_BY_MODEL;

function assertTenantScoped(
  model: TenantOwnedModel,
  { operation, args, query }: { operation: string; args: unknown; query: (args: unknown) => Promise<unknown> },
) {
  const scope = getTenantScope();

  if (!scope || scope.kind === 'PLATFORM') {
    return query(args);
  }

  const tenantIdField = TENANT_ID_FIELD_BY_MODEL[model];
  const where = (args as { where?: Record<string, unknown> } | undefined)?.where;

  if (!where || where[tenantIdField] !== scope.trainerId) {
    throw new TenantScopeViolationError(
      `Unscoped or cross-tenant query on ${model}.${operation}: expected where.${tenantIdField} === '${scope.trainerId}'`,
    );
  }

  return query(args);
}

export const tenantGuardExtension = Prisma.defineExtension({
  name: 'tenant-guard',
  query: {
    trainerProfile: {
      $allOperations: (params) => assertTenantScoped('TrainerProfile', params),
    },
    coachProfile: {
      $allOperations: (params) => assertTenantScoped('CoachProfile', params),
    },
    playerTrainerAssociation: {
      $allOperations: (params) => assertTenantScoped('PlayerTrainerAssociation', params),
    },
    shareLink: {
      $allOperations: (params) => assertTenantScoped('ShareLink', params),
    },
    coachAvailabilityOverride: {
      $allOperations: (params) => assertTenantScoped('CoachAvailabilityOverride', params),
    },
  },
});
