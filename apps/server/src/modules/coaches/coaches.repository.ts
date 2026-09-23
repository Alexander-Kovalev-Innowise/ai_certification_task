import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

// Task 4.11, skeleton only — `inviteCoach` (CoachService) delegates entirely
// to `ShareLinkService.generateCoachLink` and needs no `CoachProfile` read/
// write of its own (no profile row exists yet at invite time; one is only
// ever created at redemption, Task 4.9). Filled in for Task 4.12
// (`listByTrainer`) and Task 4.13 (the dual-actor `PATCH /coaches/:id`
// read/update) — same "repository-only skeleton, real logic lands with the
// task that needs it" pattern Task 4.1 established for
// `AssociationsRepository`.
@Injectable()
export class CoachesRepository {
  constructor(private readonly prisma: PrismaService) {}
}
