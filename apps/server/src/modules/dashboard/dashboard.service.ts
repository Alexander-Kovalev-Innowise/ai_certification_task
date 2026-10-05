import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthContext } from '../../shared/security/auth-context.interface';

import { DashboardRepository, DateRange } from './dashboard.repository';
import type {
  DashboardDeltaPeriod,
  DashboardMetricDeltaDto,
  DashboardMetricDto,
  DashboardStatsResponseDto,
} from './dto/dashboard-stats-response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30;
const WEEK_DAYS = 7;

interface Windows {
  now: Date;
  /** Rolling 30 UTC days ending now (today included). */
  month: DateRange;
  previousMonth: DateRange;
  /** Rolling 7 UTC days ending now (today included). */
  week: DateRange;
  previousWeek: DateRange;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function buildWindows(now: Date): Windows {
  // Windows are aligned to UTC day boundaries so the "per day" series' points
  // sum exactly to the matching 30-day metric. `to` is exclusive and sits one
  // millisecond past `now` so a row created this very instant is included.
  const to = new Date(now.getTime() + 1);
  const today = startOfUtcDay(now);
  const monthFrom = new Date(today.getTime() - (MONTH_DAYS - 1) * DAY_MS);
  const weekFrom = new Date(today.getTime() - (WEEK_DAYS - 1) * DAY_MS);
  return {
    now,
    month: { from: monthFrom, to },
    previousMonth: { from: new Date(monthFrom.getTime() - MONTH_DAYS * DAY_MS), to: monthFrom },
    week: { from: weekFrom, to },
    previousWeek: { from: new Date(weekFrom.getTime() - WEEK_DAYS * DAY_MS), to: weekFrom },
  };
}

export function buildDelta(current: number, previous: number, period: DashboardDeltaPeriod): DashboardMetricDeltaDto {
  const diff = current - previous;
  return { value: Math.abs(diff), period, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Zero-filled, oldest-first daily series covering exactly `range`. */
function buildDailyPoints(range: DateRange, countsByDay: Map<string, number>): Array<{ date: string; value: number }> {
  const points: Array<{ date: string; value: number }> = [];
  for (let day = startOfUtcDay(range.from).getTime(); day < range.to.getTime(); day += DAY_MS) {
    const key = toDayKey(new Date(day));
    points.push({ date: key, value: countsByDay.get(key) ?? 0 });
  }
  return points;
}

function bucketByDay(dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = toDayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// GET /dashboard/stats — role-aware, read-only aggregates for the dashboard
// metric cards. `ctx.role`/`ctx.userId`/`ctx.trainerId` are already the
// EFFECTIVE identity (auth-context.interface.ts), so an impersonated session
// gets the target's dashboard with no special-casing here. Every tenant-owned
// count is anchored on the caller's own trainerId, never a client-supplied one.
@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async getStats(ctx: AuthContext, now: Date = new Date()): Promise<DashboardStatsResponseDto> {
    const windows = buildWindows(now);
    const generatedAt = now.toISOString();

    switch (ctx.role) {
      case 'SUPER_ADMIN':
        return { role: 'SUPER_ADMIN', generatedAt, ...(await this.buildSuperAdminStats(windows)) };
      case 'TRAINER':
        return { role: 'TRAINER', generatedAt, ...(await this.buildTrainerStats(ctx, windows)) };
      case 'COACH':
        return { role: 'COACH', generatedAt, ...(await this.buildCoachStats(ctx, windows)) };
      default:
        return { role: 'PLAYER_PARENT', generatedAt, ...(await this.buildPlayerParentStats(ctx)) };
    }
  }

  private async buildSuperAdminStats(w: Windows): Promise<Pick<DashboardStatsResponseDto, 'metrics' | 'series'>> {
    const repo = this.dashboardRepository;
    const [
      totalUsers,
      activeTrainers,
      activeCoaches,
      activePlayersParents,
      inactiveOrDeleted,
      newUsers,
      previousNewUsers,
      impersonations,
      previousImpersonations,
      perDay,
    ] = await Promise.all([
      repo.countNonDeletedUsers(),
      repo.countActiveUsersByRole('TRAINER'),
      repo.countActiveUsersByRole('COACH'),
      repo.countActiveUsersByRole('PLAYER_PARENT'),
      repo.countInactiveOrDeletedUsers(),
      repo.countUsersCreatedBetween(w.month),
      repo.countUsersCreatedBetween(w.previousMonth),
      repo.countImpersonationsStartedBetween(w.week),
      repo.countImpersonationsStartedBetween(w.previousWeek),
      repo.countUsersCreatedPerDay(w.month),
    ]);

    return {
      metrics: [
        { key: 'total_users', label: 'Total users', value: totalUsers, unit: 'count', hint: 'Excluding deleted accounts' },
        { key: 'active_trainers', label: 'Active trainers', value: activeTrainers, unit: 'count' },
        { key: 'active_coaches', label: 'Coaches', value: activeCoaches, unit: 'count', hint: 'Active accounts' },
        { key: 'active_players_parents', label: 'Players & parents', value: activePlayersParents, unit: 'count', hint: 'Active accounts' },
        { key: 'inactive_accounts', label: 'Inactive & deleted accounts', value: inactiveOrDeleted, unit: 'count' },
        {
          key: 'new_users_30d',
          label: 'New users',
          value: newUsers,
          unit: 'count',
          hint: 'Last 30 days',
          delta: buildDelta(newUsers, previousNewUsers, 'month'),
        },
        {
          key: 'impersonation_sessions_7d',
          label: 'Impersonation sessions',
          value: impersonations,
          unit: 'count',
          hint: 'Last 7 days',
          delta: buildDelta(impersonations, previousImpersonations, 'week'),
        },
      ],
      series: [{ key: 'new_users_daily', label: 'New users per day', points: buildDailyPoints(w.month, perDay) }],
    };
  }

  private async buildTrainerStats(ctx: AuthContext, w: Windows): Promise<Pick<DashboardStatsResponseDto, 'metrics' | 'series'>> {
    const trainerId = ctx.trainerId ?? (await this.requireTrainer(ctx.userId));
    const repo = this.dashboardRepository;

    const [
      connectedPlayers,
      playersWithAvailability,
      newPlayers,
      previousNewPlayers,
      redemptions,
      previousRedemptions,
      activeCoaches,
      pendingInvites,
      activeLinks,
      overrides,
      previousOverrides,
      connectedDates,
    ] = await Promise.all([
      repo.countActiveAssociations(trainerId),
      repo.countActiveAssociationsWithAvailability(trainerId),
      repo.countActiveAssociationsConnectedBetween(trainerId, w.month),
      repo.countActiveAssociationsConnectedBetween(trainerId, w.previousMonth),
      repo.countRedemptionsBetween(trainerId, w.month),
      repo.countRedemptionsBetween(trainerId, w.previousMonth),
      repo.countActiveCoaches(trainerId),
      repo.countPendingCoachInvites(trainerId, w.now),
      repo.countActivePlayerShareLinks(trainerId, w.now),
      repo.countOverridesForTrainerBetween(trainerId, w.month),
      repo.countOverridesForTrainerBetween(trainerId, w.previousMonth),
      repo.findActiveAssociationConnectedAtBetween(trainerId, w.month),
    ]);

    return {
      metrics: [
        { key: 'connected_players', label: 'Connected players', value: connectedPlayers, unit: 'count', hint: 'Active connections' },
        {
          key: 'new_players_30d',
          label: 'New players',
          value: newPlayers,
          unit: 'count',
          hint: 'Last 30 days',
          delta: buildDelta(newPlayers, previousNewPlayers, 'month'),
        },
        { key: 'active_coaches', label: 'Active coaches', value: activeCoaches, unit: 'count' },
        { key: 'pending_coach_invites', label: 'Pending coach invites', value: pendingInvites, unit: 'count', hint: 'Not yet accepted' },
        { key: 'active_share_links', label: 'Active share links', value: activeLinks, unit: 'count', hint: 'Player links open for sign-up' },
        {
          key: 'share_link_redemptions_30d',
          label: 'Share link sign-ups',
          value: redemptions,
          unit: 'count',
          hint: 'Last 30 days',
          delta: buildDelta(redemptions, previousRedemptions, 'month'),
        },
        {
          key: 'players_with_availability_pct',
          label: 'Players with availability',
          value: percentOf(playersWithAvailability, connectedPlayers),
          unit: 'percent',
          hint: connectedPlayers === 0 ? 'No players connected yet' : `${playersWithAvailability} of ${plural(connectedPlayers, 'player')}`,
        },
        {
          key: 'coach_overrides_30d',
          label: 'Coach overrides',
          value: overrides,
          unit: 'count',
          hint: 'Last 30 days',
          delta: buildDelta(overrides, previousOverrides, 'month'),
        },
      ],
      series: [{ key: 'new_players_daily', label: 'New players per day', points: buildDailyPoints(w.month, bucketByDay(connectedDates)) }],
    };
  }

  private async buildCoachStats(ctx: AuthContext, w: Windows): Promise<Pick<DashboardStatsResponseDto, 'metrics' | 'series'>> {
    const repo = this.dashboardRepository;
    const coach = await repo.findCoachByUserId(ctx.userId);
    if (!coach) {
      throw new NotFoundException({ message: 'Coach profile not found', errorCode: 'NOT_FOUND' });
    }

    const [slots, minutes, overrides, previousOverrides, activeCoaches] = await Promise.all([
      repo.countAvailableSlots(coach.id),
      repo.sumAvailableMinutes(coach.id),
      repo.countOverridesForCoachBetween(coach.trainerId, coach.id, w.month),
      repo.countOverridesForCoachBetween(coach.trainerId, coach.id, w.previousMonth),
      repo.countActiveCoaches(coach.trainerId),
    ]);

    return {
      metrics: [
        { key: 'weekly_slots', label: 'Weekly availability slots', value: slots, unit: 'count', hint: 'Available time windows' },
        {
          key: 'weekly_hours',
          label: 'Available hours per week',
          value: Math.round((minutes / 60) * 10) / 10,
          unit: 'hours',
          hint: 'Across all available slots',
        },
        {
          key: 'availability_overrides_30d',
          label: 'Schedule overrides',
          value: overrides,
          unit: 'count',
          hint: 'Received in the last 30 days',
          delta: buildDelta(overrides, previousOverrides, 'month'),
        },
        {
          key: 'team_coaches',
          label: 'Coaches on the team',
          value: activeCoaches,
          unit: 'count',
          hint: `At ${coach.trainer.businessName}`,
        },
      ],
    };
  }

  private async buildPlayerParentStats(ctx: AuthContext): Promise<Pick<DashboardStatsResponseDto, 'metrics' | 'series'>> {
    const repo = this.dashboardRepository;
    const profiles = await repo.findVisibleProfiles(ctx.userId, ctx.accountType);
    const profileIds = profiles.map((profile) => profile.id);

    // "Children with availability set" when the caller has children; otherwise
    // (a self-only adult, or a CHILD login) their own profile(s) are the subject.
    const children = profiles.filter((profile) => !profile.isSelf);
    const availabilityScope = ctx.accountType === 'ADULT' && children.length > 0 ? children : profiles;
    const availabilityLabel = availabilityScope === children ? 'Children with availability' : 'Profiles with availability';

    const [connectedTrainers, withAvailability, pendingApprovals] = await Promise.all([
      repo.countDistinctActiveTrainers(profileIds),
      repo.countProfilesWithAvailability(availabilityScope.map((profile) => profile.id)),
      // VIEW_GUARDIAN_DATA is CHILD-denied (capability.enum.ts): a CHILD login never sees approvals.
      ctx.accountType === 'ADULT' ? repo.countPendingApprovals(ctx.userId) : Promise.resolve(null),
    ]);

    const metrics: DashboardMetricDto[] = [
      { key: 'profiles', label: ctx.accountType === 'ADULT' ? 'Player profiles' : 'My profile', value: profiles.length, unit: 'count', hint: ctx.accountType === 'ADULT' ? 'You and your children' : undefined },
      { key: 'connected_trainers', label: 'Connected trainers', value: connectedTrainers, unit: 'count', hint: 'Active connections' },
    ];

    if (pendingApprovals !== null) {
      metrics.push({ key: 'pending_approvals', label: 'Pending approvals', value: pendingApprovals, unit: 'count', hint: 'Waiting for your decision' });
    }

    metrics.push({
      key: 'availability_set_pct',
      label: availabilityLabel,
      value: percentOf(withAvailability, availabilityScope.length),
      unit: 'percent',
      hint: availabilityScope.length === 0 ? 'No profiles yet' : `${withAvailability} of ${availabilityScope.length}`,
    });

    return { metrics };
  }

  private async requireTrainer(userId: string): Promise<string> {
    const trainer = await this.dashboardRepository.findTrainerByUserId(userId);
    if (!trainer) {
      throw new NotFoundException({ message: 'Trainer profile not found', errorCode: 'NOT_FOUND' });
    }
    return trainer.id;
  }
}
