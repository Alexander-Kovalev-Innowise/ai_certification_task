import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Availability, PlayerProfile } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { AssociationsRepository } from '../associations/associations.repository';
import { PlayerProfilesRepository } from '../player-profiles/player-profiles.repository';

import { AvailabilityRepository } from './availability.repository';
import { AvailabilityGridResponseDto, AvailabilitySlotDto } from './dto/availability-grid.dto';

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
