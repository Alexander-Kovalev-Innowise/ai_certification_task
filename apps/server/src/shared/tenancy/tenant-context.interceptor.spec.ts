import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { of } from 'rxjs';

import type { AuthContext } from '../security/auth-context.interface';
import { runWithAuthContext } from '../security/auth-context.store';

import { TenantContextInterceptor } from './tenant-context.interceptor';
import { getTenantScope } from './tenant-context.store';

function fakeExecutionContext(): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function fakeCallHandlerReadingScope(): CallHandler {
  return {
    handle: () => of(getTenantScope()),
  };
}

function fakeReflector(crossTenant: boolean): Reflector {
  return { getAllAndOverride: () => crossTenant } as unknown as Reflector;
}

const trainerAuthContext: AuthContext = {
  userId: 'trainer-user',
  role: 'TRAINER',
  accountType: 'ADULT',
  trainerId: 'trainer-A',
  auditActorId: 'trainer-user',
};

const superAdminAuthContext: AuthContext = {
  userId: 'admin-user',
  role: 'SUPER_ADMIN',
  accountType: 'ADULT',
  auditActorId: 'admin-user',
};

describe('TenantContextInterceptor (Task 1.8)', () => {
  it('produces { kind: TRAINER, trainerId } for a TRAINER AuthContext', async () => {
    const interceptor = new TenantContextInterceptor(fakeReflector(false));

    const result = await runWithAuthContext(trainerAuthContext, () =>
      interceptor.intercept(fakeExecutionContext(), fakeCallHandlerReadingScope()).toPromise(),
    );

    expect(result).toEqual({ kind: 'TRAINER', trainerId: 'trainer-A' });
  });

  it('produces { kind: PLATFORM } for a SUPER_ADMIN with @CrossTenant() on the route', async () => {
    const interceptor = new TenantContextInterceptor(fakeReflector(true));

    const result = await runWithAuthContext(superAdminAuthContext, () =>
      interceptor.intercept(fakeExecutionContext(), fakeCallHandlerReadingScope()).toPromise(),
    );

    expect(result).toEqual({ kind: 'PLATFORM' });
  });

  it('cannot get PLATFORM scope for a SUPER_ADMIN without @CrossTenant() on the route', async () => {
    const interceptor = new TenantContextInterceptor(fakeReflector(false));

    const result = await runWithAuthContext(superAdminAuthContext, () =>
      interceptor.intercept(fakeExecutionContext(), fakeCallHandlerReadingScope()).toPromise(),
    );

    // No trainerId and no @CrossTenant(): no TenantScope is published at all.
    expect(result).toBeUndefined();
  });
});
