import { Injectable } from '@nestjs/common';
import type { CoachProfile, CoachStatus, User } from '@prisma/client';

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
}
