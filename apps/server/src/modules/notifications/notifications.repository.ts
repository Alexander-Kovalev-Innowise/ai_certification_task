import { Injectable } from '@nestjs/common';
import type { ChildPurchaseApproval, CoachAvailabilityOverride } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export type ParentApprovalRow = ChildPurchaseApproval & { playerProfile: { name: string } };
export type ChildRequestRow = ChildPurchaseApproval;
export type TrainerOverrideRow = CoachAvailabilityOverride & { coach: { user: { firstName: string; lastName: string } } };
export type CoachOverrideRow = CoachAvailabilityOverride & { trainer: { businessName: string } };

const PER_SOURCE_LIMIT = 50;

// Read side of the derived in-app notifications. Everything is computed from live
// rows (nothing is stored per notification); the only write is the per-user
// "seen" marker `NotificationRead`. Base client throughout: every query is scoped
// by the caller's own user / trainer id, which the service takes from AuthContext.
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Guardian: the children's purchase requests still awaiting their answer. */
  async pendingApprovalsForParent(parentUserId: string): Promise<ParentApprovalRow[]> {
    return this.prisma.childPurchaseApproval.findMany({
      where: { parentUserId, status: 'PENDING' },
      include: { playerProfile: { select: { name: true } } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: PER_SOURCE_LIMIT,
    });
  }

  /** Child: own requests with a guardian question outstanding, or decided/expired since `since`. */
  async requestUpdatesForChild(childUserId: string, since: Date): Promise<ChildRequestRow[]> {
    return this.prisma.childPurchaseApproval.findMany({
      where: {
        playerProfile: { childUserId },
        OR: [
          { status: 'PENDING', infoRequestedAt: { not: null } },
          { status: { in: ['APPROVED', 'DENIED'] }, respondedAt: { gte: since } },
          { status: 'EXPIRED', expiresAt: { gte: since } },
        ],
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: PER_SOURCE_LIMIT,
    });
  }

  /** Trainer: coach "request change" messages still open (the coach has not accepted since). */
  async openChangeRequestsForTrainer(trainerId: string, since: Date): Promise<TrainerOverrideRow[]> {
    return this.prisma.coachAvailabilityOverride.findMany({
      where: { trainerId, changeRequestedAt: { gte: since }, acknowledgedAt: null, coach: { status: { not: 'INACTIVE' } } },
      include: { coach: { select: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ changeRequestedAt: 'desc' }, { id: 'desc' }],
      take: PER_SOURCE_LIMIT,
    });
  }

  /** Trainer: overrides a coach accepted since `since`. */
  async acceptedOverridesForTrainer(trainerId: string, since: Date): Promise<TrainerOverrideRow[]> {
    return this.prisma.coachAvailabilityOverride.findMany({
      where: { trainerId, acknowledgedAt: { gte: since }, coach: { status: { not: 'INACTIVE' } } },
      include: { coach: { select: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ acknowledgedAt: 'desc' }, { id: 'desc' }],
      take: PER_SOURCE_LIMIT,
    });
  }

  /** Coach: overrides logged against them that they have neither accepted nor asked to change. */
  async unresolvedOverridesForCoach(coachUserId: string): Promise<CoachOverrideRow[]> {
    return this.prisma.coachAvailabilityOverride.findMany({
      where: { coach: { userId: coachUserId, status: { not: 'INACTIVE' } }, acknowledgedAt: null, changeRequestedAt: null },
      include: { trainer: { select: { businessName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PER_SOURCE_LIMIT,
    });
  }

  async readKeys(userId: string, itemKeys: string[]): Promise<Set<string>> {
    if (itemKeys.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.notificationRead.findMany({
      where: { userId, itemKey: { in: itemKeys } },
      select: { itemKey: true },
    });
    return new Set(rows.map((row) => row.itemKey));
  }

  async markRead(userId: string, itemKeys: string[]): Promise<void> {
    if (itemKeys.length === 0) {
      return;
    }
    await this.prisma.notificationRead.createMany({
      data: itemKeys.map((itemKey) => ({ userId, itemKey })),
      skipDuplicates: true,
    });
  }

  /** Read markers for items long past every window can never match again. */
  async pruneReadsBefore(before: Date): Promise<void> {
    await this.prisma.notificationRead.deleteMany({ where: { readAt: { lt: before } } });
  }
}
