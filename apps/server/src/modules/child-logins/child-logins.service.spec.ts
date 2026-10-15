import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import type { AuthContext } from '../../shared/security/auth-context.interface';

import { ChildLoginsService } from './child-logins.service';

// Unit-level (mocked collaborators) checks of the guard rails; the real
// DB-backed flow is covered by test/child-account-flow.e2e-spec.ts.
describe('ChildLoginsService', () => {
  const parentCtx: AuthContext = { userId: 'parent-1', role: 'PLAYER_PARENT', accountType: 'ADULT', auditActorId: 'parent-1' };

  const childProfile = { id: 'profile-1', accountUserId: 'parent-1', name: 'Alex Kid', isSelf: false, childUserId: null };

  function build(overrides: { profile?: unknown; existingUser?: unknown } = {}) {
    const playerProfilesRepository = { findById: jest.fn().mockResolvedValue('profile' in overrides ? overrides.profile : childProfile) };
    const accountProvisioningService = {
      createUserWithProfile: jest.fn().mockImplementation(async (input: { email: string; createProfile: (tx: unknown, userId: string) => Promise<void> }) => {
        const tx = { playerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        await input.createProfile(tx, 'child-user-1');
        return { id: 'child-user-1', email: input.email };
      }),
    };
    const passwordService = { hash: jest.fn().mockResolvedValue('hashed') };
    const usersRepository = { findByEmail: jest.fn().mockResolvedValue(overrides.existingUser ?? null), update: jest.fn() };
    const refreshTokenRepository = { revokeAllForUser: jest.fn() };
    const prisma = { $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };

    const service = new ChildLoginsService(
      playerProfilesRepository as never,
      accountProvisioningService as never,
      passwordService as never,
      usersRepository as never,
      refreshTokenRepository as never,
      prisma as never,
    );
    return { service, accountProvisioningService, usersRepository, refreshTokenRepository, passwordService };
  }

  it('creates an ACTIVE PLAYER_PARENT user named after the profile, with mustChangePassword false', async () => {
    const { service, accountProvisioningService, passwordService } = build();

    const result = await service.createChildLogin(parentCtx, 'profile-1', { email: 'alex@example.com', password: 'ChildPass1' });

    expect(result).toEqual({ playerProfileId: 'profile-1', childUserId: 'child-user-1', email: 'alex@example.com' });
    expect(passwordService.hash).toHaveBeenCalledWith('ChildPass1');
    expect(accountProvisioningService.createUserWithProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'PLAYER_PARENT',
        status: 'ACTIVE',
        mustChangePassword: false,
        firstName: 'Alex',
        lastName: 'Kid',
        passwordHash: 'hashed',
      }),
    );
  });

  it('a CHILD caller or another parent gets a generic 404', async () => {
    const { service } = build();

    await expect(
      service.createChildLogin({ ...parentCtx, accountType: 'CHILD' }, 'profile-1', { email: 'a@example.com', password: 'ChildPass1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createChildLogin({ ...parentCtx, userId: 'someone-else' }, 'profile-1', { email: 'a@example.com', password: 'ChildPass1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects the guardian\'s own (isSelf) profile with 400', async () => {
    const { service } = build({ profile: { ...childProfile, isSelf: true } });

    await expect(service.createChildLogin(parentCtx, 'profile-1', { email: 'a@example.com', password: 'ChildPass1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('409 when the profile already has a login, or the email is taken', async () => {
    const withLogin = build({ profile: { ...childProfile, childUserId: 'existing-child' } });
    await expect(withLogin.service.createChildLogin(parentCtx, 'profile-1', { email: 'a@example.com', password: 'ChildPass1' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    const emailTaken = build({ existingUser: { id: 'u' } });
    await expect(emailTaken.service.createChildLogin(parentCtx, 'profile-1', { email: 'a@example.com', password: 'ChildPass1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(emailTaken.accountProvisioningService.createUserWithProfile).not.toHaveBeenCalled();
  });

  it('reset-password: 404 without a login; otherwise updates the hash, bumps tokenVersion and revokes sessions', async () => {
    const none = build();
    await expect(none.service.resetChildLoginPassword(parentCtx, 'profile-1', 'NewChildPass2')).rejects.toBeInstanceOf(NotFoundException);

    const linked = build({ profile: { ...childProfile, childUserId: 'child-user-1' } });
    await linked.service.resetChildLoginPassword(parentCtx, 'profile-1', 'NewChildPass2');
    expect(linked.usersRepository.update).toHaveBeenCalledWith(
      'child-user-1',
      { passwordHash: 'hashed', mustChangePassword: false, tokenVersion: { increment: 1 } },
      expect.anything(),
    );
    expect(linked.refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith('child-user-1', expect.anything());
  });
});
