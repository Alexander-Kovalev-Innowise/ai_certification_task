// arch §8 Layer 2: thrown by the tenant-guard Prisma extension (Task 1.6)
// when a query against a tenant-owned model doesn't carry a `where` scoped
// to the current TRAINER TenantScope. Deliberate choice per the
// architecture: assert, don't silently inject the filter — a missing scope
// is a bug that should surface loudly in the first integration test run,
// not produce a confusing empty result set.
export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeViolationError';
  }
}
