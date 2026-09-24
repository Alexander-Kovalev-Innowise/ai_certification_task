import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { User } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import type { TenantClaimsResolver } from '../auth/tenant-claims.resolver';
import type { TokenService } from '../auth/token.service';
import type { UsersRepository } from '../users/users.repository';

import type { ImpersonationRepository } from './impersonation.repository';
import { ImpersonationService } from './impersonation.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'target-1',
    email: 'target@example.com',
    role: 'TRAINER',
    status: 'ACTIVE',
    firstName: 'Target',
    lastName: 'User',
    tokenVersion: 0,
    mustChangePassword: false,
    passwordHash: 'hash',
    phone: null,
    photoUrl: null,
    notificationPrefs: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as User;
}

function makeAdminCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'admin-1',
    role: 'SUPER_ADMIN',
    accountType: 'ADULT',
    auditActorId: 'admin-1',
    ...overrides,
  } as AuthContext;
}

// Task 7.1. Unit-level (mocked collaborators) rather than e2e — two of the
// three checks below (already-impersonating, and implicitly the SUPER_ADMIN
// target case once a caller is ALSO impersonating) can never actually be
// reached via a real HTTP call to POST /impersonation/start:
// `@Roles(SUPER_ADMIN)` guards that route, and an impersonation token's
// effective role can never BE SUPER_ADMIN (assertNotTargetingSuperAdmin
// forbids ever issuing one) — so RolesGuard's own locked-in "always uses
// the effective role, never the impersonation actor role" behavior
// (roles.guard.spec.ts) rejects any impersonation token hitting this route
// with a generic 403 FORBIDDEN before ImpersonationService.start ever runs.
// The service still enforces this independently as defense-in-depth (same
// "a single mechanism will eventually be bypassed" rationale arch §8 gives
// for its own multi-layer tenancy checks) — exercised here directly, the
// only place it's actually reachable today.
describe('ImpersonationService (Task 7.1)', () => {
  function makeService() {
    const impersonationRepository = {
      create: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<ImpersonationRepository>;
    const usersRepository = { findById: jest.fn() } as unknown as jest.Mocked<UsersRepository>;
    const tenantClaimsResolver = { resolve: jest.fn() } as unknown as jest.Mocked<TenantClaimsResolver>;
    const tokenService = { issueImpersonationToken: jest.fn() } as unknown as jest.Mocked<TokenService>;

    const service = new ImpersonationService(impersonationRepository, usersRepository, tenantClaimsResolver, tokenService);
    return { service, impersonationRepository, usersRepository, tenantClaimsResolver, tokenService };
  }

  it('rejects with 403 IMPERSONATION_NOT_ALLOWED when the caller is already impersonating (blast radius)', async () => {
    const { service, usersRepository } = makeService();
    usersRepository.findById.mockResolvedValue(makeUser());

    const ctx = makeAdminCtx({
      impersonation: { actorUserId: 'other-admin', actorRole: 'SUPER_ADMIN', logId: 'log-x', expiresAt: new Date() },
    });

    try {
      await service.start(ctx, { targetUserId: 'target-1' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'IMPERSONATION_NOT_ALLOWED' });
    }
  });

  it('rejects with 422 IMPERSONATION_TARGET_INVALID when the target is a SUPER_ADMIN', async () => {
    const { service, usersRepository } = makeService();
    usersRepository.findById.mockResolvedValue(makeUser({ role: 'SUPER_ADMIN' }));

    try {
      await service.start(makeAdminCtx(), { targetUserId: 'target-1' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({ errorCode: 'IMPERSONATION_TARGET_INVALID' });
    }
  });

  it('rejects with 404 NOT_FOUND when the target does not exist', async () => {
    const { service, usersRepository } = makeService();
    usersRepository.findById.mockResolvedValue(null);

    await expect(service.start(makeAdminCtx(), { targetUserId: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('issues an impersonation token carrying the exact act claim, and creates the ImpersonationLog row', async () => {
    const { service, usersRepository, impersonationRepository, tenantClaimsResolver, tokenService } = makeService();
    usersRepository.findById.mockResolvedValue(makeUser());
    impersonationRepository.create.mockResolvedValue({
      id: 'log-1',
      adminUserId: 'admin-1',
      targetUserId: 'target-1',
      startedAt: new Date(),
      endedAt: null,
      durationSeconds: null,
      createdAt: new Date(),
    });
    tenantClaimsResolver.resolve.mockResolvedValue({ accountType: 'ADULT', trainerId: 'trainer-profile-1', guardianUserId: null });
    tokenService.issueImpersonationToken.mockResolvedValue({ accessToken: 'signed.jwt.token', expiresIn: 3600 });

    const result = await service.start(makeAdminCtx(), { targetUserId: 'target-1' });

    expect(impersonationRepository.create).toHaveBeenCalledWith({ adminUserId: 'admin-1', targetUserId: 'target-1' });
    expect(tokenService.issueImpersonationToken).toHaveBeenCalledWith({
      userId: 'target-1',
      role: 'TRAINER',
      accountType: 'ADULT',
      guardianUserId: null,
      trainerId: 'trainer-profile-1',
      tokenVersion: 0,
      actorUserId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      logId: 'log-1',
    });
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      expiresIn: 3600,
      impersonationLogId: 'log-1',
      target: {
        id: 'target-1',
        email: 'target@example.com',
        role: 'TRAINER',
        accountType: 'ADULT',
        firstName: 'Target',
        lastName: 'User',
        mustChangePassword: false,
      },
    });
  });
});
