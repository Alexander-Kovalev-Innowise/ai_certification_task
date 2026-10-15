import { AsyncLocalStorage } from 'node:async_hooks';

import type { TenantScope } from './tenant-scope.type';

// Task 1.8 (created early in Task 1.6, see tenant-scope.type.ts for why).
// Published by TenantContextInterceptor (Task 1.8) at guard-pipeline step 8
// (arch §5) — after JwtAuthGuard (step 5), which is what lets Task 1.6's
// tenant-guard extension safely run before any scope exists in ALS.
export const tenantContextStorage = new AsyncLocalStorage<TenantScope>();

export function getTenantScope(): TenantScope | undefined {
  return tenantContextStorage.getStore();
}

// Deliberately always returns a Promise and wraps `fn` in an inner `async`
// callback, even when `fn` is synchronous. Prisma Client's query methods
// return lazy "thenables" — calling e.g. `prisma.coachProfile.findMany(...)`
// does not itself run anything; the query only actually executes once
// something awaits/thens the returned value. AsyncLocalStorage's context
// guarantee for `run(store, callback)` covers the *entire lifetime of an
// async callback* (every one of its awaits), but only the *synchronous*
// portion of a non-async one. `run(scope, () => prisma.x.findMany(...))`
// therefore returns the lazy thenable while still inside the ALS context,
// but nothing actually triggers it until later — outside that context —
// so any extension reading the scope during execution sees `undefined`.
// Wrapping in `async () => fn()` forces the returned thenable to be
// unwrapped (awaited) as part of *this* async function's own continuation,
// which Node correctly keeps tied to the `run()` context throughout.
export function runWithTenantScope<T>(scope: TenantScope, fn: () => T | PromiseLike<T>): Promise<T> {
  return tenantContextStorage.run(scope, async () => fn());
}
