import { Injectable } from '@nestjs/common';
import type { CoachProfile, TrainerProfile } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface DateRange {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

export type CoachWithTrainer = CoachProfile & { trainer: TrainerProfile };

// Read-only aggregate queries backing GET /dashboard/stats. Every
// tenant-owned model (TrainerProfile/CoachProfile/PlayerTrainerAssociation/
// ShareLink/CoachAvailabilityOverride) is read through `prisma.extended` with
// the owning `trainerId` in the top-level `where`, so the tenant-guard
// extension's runtime net (arch §8 Layer 2) backs the explicit filtering.
// Platform-wide counts (SUPER_ADMIN) and the caller's own identity lookups use
// the base client.
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- identity

  findTrainerByUserId(userId: string): Promise<TrainerProfile | null> {
    return this.prisma.trainerProfile.findUnique({ where: { userId } });
  }

  findCoachByUserId(userId: string): Promise<CoachWithTrainer | null> {
    return this.prisma.coachProfile.findUnique({ where: { userId }, include: { trainer: true } });
  }

  // ------------------------------------------------------------- SUPER_ADMIN

  countNonDeletedUsers(): Promise<number> {
    return this.prisma.user.count({ where: { status: { not: 'DELETED' } } });
  }

  countActiveUsersByRole(role: 'TRAINER' | 'COACH' | 'PLAYER_PARENT'): Promise<number> {
    return this.prisma.user.count({ where: { role, status: 'ACTIVE' } });
  }

  countInactiveOrDeletedUsers(): Promise<number> {
    return this.prisma.user.count({ where: { status: { in: ['INACTIVE', 'DELETED'] } } });
  }

  countUsersCreatedBetween({ from, to }: DateRange): Promise<number> {
    return this.prisma.user.count({ where: { status: { not: 'DELETED' }, createdAt: { gte: from, lt: to } } });
  }

  countImpersonationsStartedBetween({ from, to }: DateRange): Promise<number> {
    return this.prisma.impersonationLog.count({ where: { startedAt: { gte: from, lt: to } } });
  }

  /** `YYYY-MM-DD` (UTC) -> number of non-deleted users created that day. Days with no signups are absent. */
  async countUsersCreatedPerDay({ from, to }: DateRange): Promise<Map<string, number>> {
    // `createdAt` is `timestamp(3)` holding UTC wall-clock time (Prisma's own
    // convention), so `to_char` on the raw column already yields the UTC day.
    const rows = await this.prisma.$queryRaw<Array<{ day: string; count: number }>>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "User"
      WHERE "status" <> 'DELETED' AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1
    `;
    return new Map(rows.map((row) => [row.day, Number(row.count)]));
  }

  // ----------------------------------------------------------------- TRAINER

  countActiveAssociations(trainerId: string): Promise<number> {
    return this.prisma.extended.playerTrainerAssociation.count({ where: { trainerId, status: 'ACTIVE' } });
  }

  countActiveAssociationsWithAvailability(trainerId: string): Promise<number> {
    return this.prisma.extended.playerTrainerAssociation.count({
      where: { trainerId, status: 'ACTIVE', playerProfile: { deletedAt: null, availability: { some: {} } } },
    });
  }

  countActiveAssociationsConnectedBetween(trainerId: string, { from, to }: DateRange): Promise<number> {
    return this.prisma.extended.playerTrainerAssociation.count({
      where: { trainerId, status: 'ACTIVE', connectedAt: { gte: from, lt: to } },
    });
  }

  /** Associations created by redeeming one of this trainer's share links (any status: the redemption happened). */
  countRedemptionsBetween(trainerId: string, { from, to }: DateRange): Promise<number> {
    return this.prisma.extended.playerTrainerAssociation.count({
      where: { trainerId, shareLinkId: { not: null }, connectedAt: { gte: from, lt: to } },
    });
  }

  async findActiveAssociationConnectedAtBetween(trainerId: string, { from, to }: DateRange): Promise<Date[]> {
    const rows = await this.prisma.extended.playerTrainerAssociation.findMany({
      where: { trainerId, status: 'ACTIVE', connectedAt: { gte: from, lt: to } },
      select: { connectedAt: true },
    });
    return rows.map((row) => row.connectedAt);
  }

  countActiveCoaches(trainerId: string): Promise<number> {
    return this.prisma.extended.coachProfile.count({ where: { trainerId, status: 'ACTIVE' } });
  }

  /** Outstanding single-use coach invites (COACH_UNIQUE links still ACTIVE and not time-expired). */
  countPendingCoachInvites(trainerId: string, now: Date): Promise<number> {
    return this.prisma.extended.shareLink.count({
      where: { trainerId, type: 'COACH_UNIQUE', status: 'ACTIVE', expiresAt: { gt: now } },
    });
  }

  /** Reusable player share links that can still be redeemed (ACTIVE and not time-expired). */
  countActivePlayerShareLinks(trainerId: string, now: Date): Promise<number> {
    return this.prisma.extended.shareLink.count({
      where: {
        trainerId,
        type: 'PLAYER_STATIC',
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  countOverridesForTrainerBetween(trainerId: string, { from, to }: DateRange): Promise<number> {
    return this.prisma.extended.coachAvailabilityOverride.count({
      where: { trainerId, createdAt: { gte: from, lt: to } },
    });
  }

  // ------------------------------------------------------------------- COACH

  countAvailableSlots(coachProfileId: string): Promise<number> {
    return this.prisma.availability.count({ where: { coachProfileId, isAvailable: true } });
  }

  /** Total available minutes per week: sum(endTime) - sum(startTime) over the coach's available slots. */
  async sumAvailableMinutes(coachProfileId: string): Promise<number> {
    const result = await this.prisma.availability.aggregate({
      where: { coachProfileId, isAvailable: true },
      _sum: { startTime: true, endTime: true },
    });
    return (result._sum.endTime ?? 0) - (result._sum.startTime ?? 0);
  }

  countOverridesForCoachBetween(trainerId: string, coachId: string, { from, to }: DateRange): Promise<number> {
    return this.prisma.extended.coachAvailabilityOverride.count({
      where: { trainerId, coachId, createdAt: { gte: from, lt: to } },
    });
  }

  // ----------------------------------------------------------- PLAYER_PARENT

  /**
   * ADULT: every profile the caller owns (self + children). CHILD: only the
   * profile that login was minted for. Soft-deleted profiles are excluded by
   * the soft-delete extension.
   */
  findVisibleProfiles(userId: string, accountType: 'ADULT' | 'CHILD'): Promise<Array<{ id: string; isSelf: boolean }>> {
    return this.prisma.extended.playerProfile.findMany({
      where: accountType === 'CHILD' ? { childUserId: userId } : { accountUserId: userId },
      select: { id: true, isSelf: true },
    });
  }

  async countDistinctActiveTrainers(profileIds: string[]): Promise<number> {
    if (profileIds.length === 0) {
      return 0;
    }
    const rows = await this.prisma.extended.playerTrainerAssociation.findMany({
      where: { playerProfileId: { in: profileIds }, status: 'ACTIVE' },
      distinct: ['trainerId'],
      select: { trainerId: true },
    });
    return rows.length;
  }

  async countProfilesWithAvailability(profileIds: string[]): Promise<number> {
    if (profileIds.length === 0) {
      return 0;
    }
    return this.prisma.extended.playerProfile.count({ where: { id: { in: profileIds }, availability: { some: {} } } });
  }

  countPendingApprovals(parentUserId: string): Promise<number> {
    return this.prisma.childPurchaseApproval.count({ where: { parentUserId, status: 'PENDING' } });
  }
}
