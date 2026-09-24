import { Injectable } from '@nestjs/common';
import type { CoachProfile, CoachStatus, Prisma, User } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export type CoachProfileWithUser = CoachProfile & { user: User };

// Task 4.11 skeleton, filled in for Task 4.12 (`listByTrainer`) and Task
// 4.13 (the dual-actor `PATCH /coaches/:id` read/update) — same
// "repository-only skeleton, real logic lands with the task that needs it"
// pattern Task 4.1 established for `AssociationsRepository`.
@Injectable()
export class CoachesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Task 4.12 (api §4.2 "GET /trainers/:id/coaches"). Goes through
   * `.extended` for the tenant-guard runtime net (arch §8 Layer 2) —
   * `where.trainerId` is always present, so `CoachService.listCoaches`'s own
   * `assertOwnershipOrNotFound` (run first) is what keeps a mismatched id
   * from ever reaching here, same ordering TrainerService/ShareLinkService
   * already document. Includes the `User` relation — the roster row needs
   * `name`/`email`, neither of which lives on `CoachProfile` itself.
   */
  async listByTrainer(trainerId: string, status?: CoachStatus): Promise<CoachProfileWithUser[]> {
    return this.prisma.extended.coachProfile.findMany({
      where: { trainerId, ...(status ? { status } : {}) },
      include: { user: true },
      orderBy: { joinedAt: 'desc' },
    });
  }

  /**
   * Task 4.13 (api §4.2 "PATCH /coaches/:id"). Goes through `.extended` for
   * the tenant-guard runtime net (arch §8 Layer 2) — `where.trainerId` is
   * always present, satisfied by the CALLER's own `tid` claim
   * (`access-token-claims.interface.ts`: TRAINER -> own id, COACH ->
   * employing trainer), which `CoachService.updateCoach` always has for
   * both dual-actor roles. This alone is NOT the full ownership check for a
   * COACH caller (it only proves "same trainer", not "my own profile" —
   * another coach under the same trainer would also match) —
   * `CoachService.updateCoach` does the extra `userId` comparison itself
   * for that actor.
   */
  async findByIdForTrainer(id: string, trainerId: string): Promise<CoachProfileWithUser | null> {
    return this.prisma.extended.coachProfile.findFirst({ where: { id, trainerId }, include: { user: true } });
  }

  /** Base client — ownership already verified by the caller (CoachService.updateCoach), same division of labor as ShareLinksRepository.revoke. */
  async update(id: string, data: Prisma.CoachProfileUpdateInput): Promise<CoachProfile> {
    return this.prisma.coachProfile.update({ where: { id }, data });
  }

  /**
   * Task 6.1. Base (non-`.extended`) client, deliberately unscoped by
   * tenant — the coach "My Times" GET/PUT pair (AvailabilityService) and the
   * conflict-check/override flows (ConflictCheckService, AvailabilityService)
   * all need to resolve a `CoachProfile` by id FIRST, before they can decide
   * whether the caller is the coach themself, the employing trainer, or a
   * stranger — that decision is exactly what determines the `404` vs `403`
   * split those endpoints document (api §4.5), so the lookup itself can't
   * already be tenant-filtered. Includes `user` for the same reason
   * `listByTrainer`/`findByIdForTrainer` do: callers need the coach's name/
   * email (override notification email, response shaping) and there's no
   * separate column for either on `CoachProfile`.
   */
  async findById(id: string): Promise<CoachProfileWithUser | null> {
    return this.prisma.coachProfile.findUnique({ where: { id }, include: { user: true } });
  }
}
