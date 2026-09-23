import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import type { AuthContext } from '../auth-context.interface';
import { getAuthContext } from '../auth-context.store';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';

import { AuthContextInterceptor } from './auth-context.interceptor';

// Task 2.4 (the fix for the `enterWith`-after-await gap described in
// jwt-auth.guard.ts). Proves what the guard itself cannot: that AuthContext
// is actually visible via getAuthContext() to code invoked further down the
// pipeline (here simulated by CallHandler.handle()).
describe('AuthContextInterceptor (Task 2.4)', () => {
  const interceptor = new AuthContextInterceptor();

  function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('passes through untouched when the request has no AuthContext (e.g. a @Public() route)', async () => {
    let sawStoreDuringHandle: AuthContext | undefined = 'untouched' as unknown as AuthContext;
    const handler: CallHandler = {
      handle: () => {
        sawStoreDuringHandle = getAuthContext();
        return of('ok');
      },
    };

    const result = await interceptor.intercept(makeContext({}), handler).toPromise();

    expect(result).toBe('ok');
    expect(sawStoreDuringHandle).toBeUndefined();
  });

  it('publishes AuthContext to ALS for the remainder of the pipeline (downstream handler sees it)', async () => {
    const authContext: AuthContext = {
      userId: 'user-1',
      role: 'TRAINER',
      accountType: 'ADULT',
      auditActorId: 'user-1',
    };
    let sawStoreDuringHandle: AuthContext | undefined;
    const handler: CallHandler = {
      handle: () => {
        sawStoreDuringHandle = getAuthContext();
        return of('ok');
      },
    };

    await interceptor.intercept(makeContext({ authContext }), handler).toPromise();

    expect(sawStoreDuringHandle).toEqual(authContext);
  });
});
