import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CoachProfile } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { CoachesRepository } from '../coaches/coaches.repository';

import { AvailabilityRepository } from './availability.repository';
import { ConflictCheckQueryDto, ConflictCheckResponseDto } from './dto/availability-grid.dto';

/**
 * Task 6.2 (api §4.5 "GET /coaches/:id/availability/check", *added* —
 * FR-063's pre-assignment warning). "Gap-fill": a conflict is any requested
 * `[startTime, endTime)` window that ISN'T fully covered by one of the
 * coach's own `isAvailable: true` slots for that `dayOfWeek` — i.e. there's
 * a gap in what the coach has committed to. A window that only *partially*
 * overlaps an available slot, or lands entirely outside one, both count as
 * a conflict; this endpoint never blocks anything itself (BR-012) — it's a
 * read the trainer's own UI calls before deciding whether to override.
 */
@Injectable()
export class ConflictCheckService {
  constructor(
    private readonly coachesRepository: CoachesRepository,
    private readonly availabilityRepository: AvailabilityRepository,
  ) {}

  async checkConflict(ctx: AuthContext, coachProfileId: string, query: ConflictCheckQueryDto): Promise<ConflictCheckResponseDto> {
    await this.resolveEmployedCoachOrThrow(ctx, coachProfileId);

    const slots = await this.availabilityRepository.findSlotsForCoach(coachProfileId, query.dayOfWeek);
    const fullyCovered = slots.some(
      (slot) => slot.isAvailable && slot.startTime <= query.startTime && slot.endTime >= query.endTime,
    );

    return { hasConflict: !fullyCovered };
  }

  /**
   * "Only the employing trainer" (api §4.5) — a `SUPER_ADMIN` may act on any
   * coach, a `TRAINER` only their own. Deliberately `403`, never `404`, for
   * every failure mode including an unknown `coachProfileId` — same
   * literal status-code set api §4.5 documents for this endpoint (no `404`
   * branch listed), and AvailabilityService.createOverride (Task 6.3) shares
   * this exact rule, see that method's twin copy of this helper.
   */
  private async resolveEmployedCoachOrThrow(ctx: AuthContext, coachProfileId: string): Promise<CoachProfile> {
    const coachProfile =
      ctx.role === 'SUPER_ADMIN'
        ? await this.coachesRepository.findById(coachProfileId)
        : ctx.trainerId
          ? await this.coachesRepository.findByIdForTrainer(coachProfileId, ctx.trainerId)
          : null;

    if (!coachProfile) {
      throw new ForbiddenException({ message: 'Only the employing trainer may perform this action', errorCode: 'FORBIDDEN' });
    }

    return coachProfile;
  }
}
