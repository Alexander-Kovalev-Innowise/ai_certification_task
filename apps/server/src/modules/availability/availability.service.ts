import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Availability, CoachProfile, PlayerProfile, Prisma } from '@prisma/client';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildCoachOverrideNotifyEmailPayload } from '../../shared/mail/templates/coach-override-notify.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { AssociationsRepository } from '../associations/associations.repository';
import { CoachesRepository, CoachProfileWithUser } from '../coaches/coaches.repository';
import { PlayerProfilesRepository } from '../player-profiles/player-profiles.repository';

import { AvailabilityRepository } from './availability.repository';
import { AvailabilityGridResponseDto, AvailabilitySlotDto, CoachAvailabilityGridResponseDto } from './dto/availability-grid.dto';
import { CoachOverrideResponseDto, CreateOverrideDto } from './dto/create-override.dto';

// Task 5.11 (api §4.5 "Player availability", FR-090). `Availability` has no
// `trainerId` column (api §0.3's explicit design note) — the SAME weekly
// grid is visible to every trainer/coach the player is associated with, so
// read access is an association-based check (AssociationsRepository), not
// header-based (`X-Trainer-Context` is deliberately N/A for both endpoints
// here — api §4.5).
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly playerProfilesRepository: PlayerProfilesRepository,
    private readonly associationsRepository: AssociationsRepository,
    private readonly coachesRepository: CoachesRepository,
    private readonly outboxService: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * `GET /player-profiles/:id/availability`. Readable by the owner (adult
   * self/child), the child themself, `SUPER_ADMIN`, or any `TRAINER`/`COACH`
   * with this player currently on their roster (an `ACTIVE`
   * `PlayerTrainerAssociation` — `ctx.trainerId` covers both roles, since a
   * COACH's `tid` claim is their employing trainer's id,
   * access-token-claims.interface.ts).
   */
  async getSummaryForPlayer(ctx: AuthContext, playerProfileId: string): Promise<AvailabilityGridResponseDto> {
    const profile = await this.playerProfilesRepository.findById(playerProfileId);
    if (!profile || !(await this.canRead(ctx, profile))) {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }

    const slots = await this.availabilityRepository.findSlotsForPlayer(playerProfileId);
    return this.toResponse(playerProfileId, slots);
  }

  /**
   * `PUT /player-profiles/:id/availability` (FR-090). Full replace, owning
   * adult or the child themself ONLY — an associated TRAINER/COACH can read
   * this grid (above) but never write it; a non-owner (including a
   * roster-associated trainer) gets the same generic `404` as an unknown
   * profile (arch §8 Layer 3 existence-disclosure posture, applied to
   * family ownership here rather than trainer tenancy).
   */
  async setPlayerAvailability(
    ctx: AuthContext,
    playerProfileId: string,
    slots: AvailabilitySlotDto[],
  ): Promise<AvailabilityGridResponseDto> {
    const profile = await this.playerProfilesRepository.findById(playerProfileId);
    if (!profile || !this.canWrite(ctx, profile)) {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }

    this.assertValidRanges(slots);

    const updated = await this.availabilityRepository.replaceSlotsForPlayer(playerProfileId, slots);
    return this.toResponse(playerProfileId, updated);
  }

  /**
   * Task 6.1 (api §4.5 "GET /coaches/:id/availability", FR-062 "My Times").
   * Readable by the coach themself, `SUPER_ADMIN`, or the employing trainer
   * (`ctx.trainerId === coachProfile.trainerId` — covers a `TRAINER` token
   * directly, and would also match a coworker `COACH`'s own token since
   * every `COACH`'s `tid` claim IS the employing trainer's id; that's
   * accepted here, unlike `setCoachAvailability` below, per Task 6.1's own
   * "GET open to the employing trainer too" — it doesn't say "and ONLY the
   * employing trainer," unlike the `PUT` pair). Every failure mode
   * (unknown id or a stranger) collapses to the same generic `404` — api
   * §4.5 lists no `403` for this endpoint, only for `PUT`.
   */
  async getSummaryForCoach(ctx: AuthContext, coachProfileId: string): Promise<CoachAvailabilityGridResponseDto> {
    const coachProfile = await this.coachesRepository.findById(coachProfileId);
    if (!coachProfile || !this.canReadCoach(ctx, coachProfile)) {
      throw new NotFoundException({ message: 'Coach not found', errorCode: 'NOT_FOUND' });
    }

    const slots = await this.availabilityRepository.findSlotsForCoach(coachProfileId);
    return this.toCoachResponse(coachProfileId, slots);
  }

  /**
   * Task 6.1 (api §4.5 "PUT /coaches/:id/availability", FR-062). Full
   * replace, the coach themself ONLY — an existing `coachProfileId` that
   * belongs to someone else (the employing trainer, a coworker coach, or a
   * different tenant entirely) is a `403`, not the generic ownership `404`
   * `setPlayerAvailability` uses above; api §4.5's own status-code table
   * lists `403 FORBIDDEN (PUT by non-owner)` explicitly. A genuinely unknown
   * id is still `404`.
   */
  async setCoachAvailability(
    ctx: AuthContext,
    coachProfileId: string,
    slots: AvailabilitySlotDto[],
  ): Promise<CoachAvailabilityGridResponseDto> {
    const coachProfile = await this.coachesRepository.findById(coachProfileId);
    if (!coachProfile) {
      throw new NotFoundException({ message: 'Coach not found', errorCode: 'NOT_FOUND' });
    }
    if (!this.canWriteCoach(ctx, coachProfile)) {
      throw new ForbiddenException({ message: 'Only the coach themself may set this availability', errorCode: 'FORBIDDEN' });
    }

    this.assertValidRanges(slots);

    const updated = await this.availabilityRepository.replaceSlotsForCoach(coachProfileId, slots);
    return this.toCoachResponse(coachProfileId, updated);
  }

  /**
   * Task 6.3 (api §4.5 "POST /coaches/:id/availability/override", FR-063/
   * BR-012). Only the employing trainer (or `SUPER_ADMIN`) — never blocks,
   * this only logs a decision the trainer already made. The audit row
   * (`event_id`, `coach_id`, `override_reason` -> `reason`, `overridden_by`
   * -> `trainerId`, `createdAt`) and the `OutboxJob(EMAIL_COACH_OVERRIDE_NOTIFY)`
   * enqueue commit together in one `$transaction` (arch §13.2) — the
   * notification must not fire for an override that didn't actually
   * persist.
   */
  async createOverride(ctx: AuthContext, coachProfileId: string, dto: CreateOverrideDto): Promise<CoachOverrideResponseDto> {
    const coachProfile = await this.resolveEmployedCoachOrThrow(ctx, coachProfileId);

    const override = await this.prisma.$transaction(async (tx) => {
      const created = await this.availabilityRepository.createOverride(
        { eventId: dto.eventId, coachId: coachProfile.id, trainerId: coachProfile.trainerId, reason: dto.reason },
        tx,
      );
      await this.outboxService.enqueue(
        tx,
        JOB_TYPES.EMAIL_COACH_OVERRIDE_NOTIFY,
        buildCoachOverrideNotifyEmailPayload(coachProfile.user.email, {
          coachFirstName: coachProfile.user.firstName,
          trainerBusinessName: coachProfile.trainer.businessName,
          reason: dto.reason,
        }) as unknown as Prisma.InputJsonValue,
      );
      return created;
    });

    return {
      id: override.id,
      eventId: override.eventId,
      coachId: override.coachId,
      trainerId: override.trainerId,
      reason: override.reason,
      createdAt: override.createdAt,
    };
  }

  /**
   * "Only the employing trainer" (api §4.5) — twin of
   * ConflictCheckService's own private copy of this same rule (see that
   * file's comment for why it isn't shared: two small, independently
   * readable copies beat a cross-service dependency for eight lines of
   * logic). Deliberately `403`, never `404`, for every failure mode — api
   * §4.5 lists no `404` branch for this endpoint either.
   */
  private async resolveEmployedCoachOrThrow(
    ctx: AuthContext,
    coachProfileId: string,
  ): Promise<CoachProfileWithUser & { trainer: { businessName: string } }> {
    const coachProfile =
      ctx.role === 'SUPER_ADMIN'
        ? await this.coachesRepository.findById(coachProfileId)
        : ctx.trainerId
          ? await this.coachesRepository.findByIdForTrainer(coachProfileId, ctx.trainerId)
          : null;

    if (!coachProfile) {
      throw new ForbiddenException({ message: 'Only the employing trainer may perform this action', errorCode: 'FORBIDDEN' });
    }

    const trainerProfile = await this.prisma.trainerProfile.findUniqueOrThrow({ where: { id: coachProfile.trainerId } });
    return { ...coachProfile, trainer: trainerProfile };
  }

  private canReadCoach(ctx: AuthContext, coachProfile: CoachProfile): boolean {
    if (ctx.role === 'SUPER_ADMIN' || this.canWriteCoach(ctx, coachProfile)) {
      return true;
    }
    return ctx.role === 'TRAINER' && ctx.trainerId === coachProfile.trainerId;
  }

  private canWriteCoach(ctx: AuthContext, coachProfile: CoachProfile): boolean {
    return ctx.role === 'COACH' && coachProfile.userId === ctx.userId;
  }

  private toCoachResponse(coachProfileId: string, slots: Availability[]): CoachAvailabilityGridResponseDto {
    return {
      coachProfileId,
      slots: slots.map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isAvailable: slot.isAvailable,
      })),
    };
  }

  private assertValidRanges(slots: AvailabilitySlotDto[]): void {
    const invalid = slots.filter((slot) => slot.startTime >= slot.endTime);
    if (invalid.length > 0) {
      throw new BadRequestException({
        message: 'Each slot requires startTime < endTime',
        errorCode: 'VALIDATION_ERROR',
        details: invalid.map((slot) => ({
          field: 'slots',
          message: `dayOfWeek ${slot.dayOfWeek}: startTime (${slot.startTime}) must be before endTime (${slot.endTime})`,
        })),
      });
    }
  }

  private canWrite(ctx: AuthContext, profile: PlayerProfile): boolean {
    if (ctx.accountType === 'CHILD') {
      return profile.childUserId === ctx.userId;
    }
    return profile.accountUserId === ctx.userId;
  }

  private async canRead(ctx: AuthContext, profile: PlayerProfile): Promise<boolean> {
    if (ctx.role === 'SUPER_ADMIN' || this.canWrite(ctx, profile)) {
      return true;
    }
    if ((ctx.role === 'TRAINER' || ctx.role === 'COACH') && ctx.trainerId) {
      const association = await this.associationsRepository.findActive(ctx.trainerId, profile.id);
      return association !== null;
    }
    return false;
  }

  private toResponse(playerProfileId: string, slots: Availability[]): AvailabilityGridResponseDto {
    return {
      playerProfileId,
      slots: slots.map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isAvailable: slot.isAvailable,
      })),
    };
  }
}
