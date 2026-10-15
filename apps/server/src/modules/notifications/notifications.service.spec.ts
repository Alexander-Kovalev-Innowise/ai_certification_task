import { NotFoundException } from '@nestjs/common';

import type { AuthContext } from '../../shared/security/auth-context.interface';

import type { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

function makeRepo(overrides: Partial<Record<keyof NotificationsRepository, jest.Mock>> = {}): jest.Mocked<NotificationsRepository> {
  return {
    pendingApprovalsForParent: jest.fn().mockResolvedValue([]),
    requestUpdatesForChild: jest.fn().mockResolvedValue([]),
    openChangeRequestsForTrainer: jest.fn().mockResolvedValue([]),
    acceptedOverridesForTrainer: jest.fn().mockResolvedValue([]),
    unresolvedOverridesForCoach: jest.fn().mockResolvedValue([]),
    readKeys: jest.fn().mockResolvedValue(new Set<string>()),
    markRead: jest.fn().mockResolvedValue(undefined),
    pruneReadsBefore: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<NotificationsRepository>;
}

const coachCtx: AuthContext = { userId: 'u-coach', role: 'COACH', accountType: 'ADULT', trainerId: 't1', auditActorId: 'u-coach' };

function overrideRow(id: string, createdAt: Date) {
  return { id, createdAt, reason: 'Cover', sessionLabel: null, trainer: { businessName: 'Acme' } };
}

describe('NotificationsService', () => {
  it('lists newest first and flags read items', async () => {
    const repo = makeRepo({
      unresolvedOverridesForCoach: jest.fn().mockResolvedValue([overrideRow('a', new Date('2026-01-01')), overrideRow('b', new Date('2026-02-01'))]),
      readKeys: jest.fn().mockResolvedValue(new Set(['override:a'])),
    });

    const res = await new NotificationsService(repo).list(coachCtx);

    expect(res.items.map((i) => i.id)).toEqual(['override:b', 'override:a']);
    expect(res.items.map((i) => i.read)).toEqual([false, true]);
    expect(res.unreadCount).toBe(1);
  });

  it('SUPER_ADMIN gets an empty feed without querying anything', async () => {
    const repo = makeRepo();
    const res = await new NotificationsService(repo).list({ userId: 'a', role: 'SUPER_ADMIN', accountType: 'ADULT', auditActorId: 'a' });

    expect(res).toEqual({ unreadCount: 0, items: [] });
    expect(repo.unresolvedOverridesForCoach).not.toHaveBeenCalled();
  });

  it('markRead rejects an id that is not in the caller feed and writes nothing', async () => {
    const repo = makeRepo();
    await expect(new NotificationsService(repo).markRead(coachCtx, 'override:nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.markRead).not.toHaveBeenCalled();
  });

  it('read-state writes are skipped while a Super Admin impersonates the user', async () => {
    const repo = makeRepo({ unresolvedOverridesForCoach: jest.fn().mockResolvedValue([overrideRow('a', new Date())]) });
    const impersonated: AuthContext = {
      ...coachCtx,
      impersonation: { actorUserId: 'admin', actorRole: 'SUPER_ADMIN', logId: 'l1', expiresAt: new Date(Date.now() + 60_000) },
    };
    const service = new NotificationsService(repo);

    await service.markRead(impersonated, 'override:a');
    await service.markAllRead(impersonated);

    expect(repo.markRead).not.toHaveBeenCalled();
  });

  it('markAllRead stores a marker for every current item', async () => {
    const repo = makeRepo({
      unresolvedOverridesForCoach: jest.fn().mockResolvedValue([overrideRow('a', new Date()), overrideRow('b', new Date())]),
    });

    await new NotificationsService(repo).markAllRead(coachCtx);

    expect(repo.markRead).toHaveBeenCalledWith('u-coach', ['override:a', 'override:b']);
  });
});
