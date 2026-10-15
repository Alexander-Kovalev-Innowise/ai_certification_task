// Task 1.8 (per the plan's task list), created early in Task 1.6 because the
// tenant-guard Prisma extension needs a TenantScope shape to read from ALS
// before Task 1.8's TenantContextInterceptor exists to publish one — the
// same "build it now, formalize later" ordering the plan uses elsewhere in
// Phase 1 (e.g. Tasks 1.6/1.7 against a manually-set ALS value ahead of
// their real publishers).
//
// `PLATFORM` has no public constructor by convention: nothing in this file
// exports a way to construct `{ kind: 'PLATFORM' }` directly. Task 1.8's
// TenantContextInterceptor is the only place that builds a TenantScope value
// at all (from AuthContext.trainerId / the @CrossTenant() decorator), and it
// refuses to produce PLATFORM for a non-SUPER_ADMIN effective role — arch §8.
export type TenantScope = { kind: 'TRAINER'; trainerId: string } | { kind: 'PLATFORM' };
