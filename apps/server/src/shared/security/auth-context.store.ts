import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthContext } from './auth-context.interface';

// Task 2.2 (created early in Task 1.7, see auth-context.interface.ts for
// why). Published by JwtAuthGuard (Task 2.4) at guard-pipeline step 5
// (arch §5), before this file's real consumer.
export const authContextStorage = new AsyncLocalStorage<AuthContext>();

export function getAuthContext(): AuthContext | undefined {
  return authContextStorage.getStore();
}

// Always wraps `fn` in an inner `async` callback and returns a Promise, even
// for a synchronous `fn` — see the comment on tenant-context.store.ts's
// runWithTenantScope for why: Prisma Client's query methods are lazy
// thenables, and AsyncLocalStorage only guarantees context propagation
// across the *entire lifetime of an async callback* passed to `run()`, not
// just its synchronous portion. A caller that returns an un-awaited lazy
// Prisma call from a non-async `run()` callback would silently lose the
// context by the time anything actually executes the query.
export function runWithAuthContext<T>(context: AuthContext, fn: () => T | PromiseLike<T>): Promise<T> {
  return authContextStorage.run(context, async () => fn());
}
