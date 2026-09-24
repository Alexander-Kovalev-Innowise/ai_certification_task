import { Injectable } from '@nestjs/common';
import type { Prisma, TrainerProfile } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

// Task 3.8, extended in Task 3.9 (findById/update, tenant-scoped reads/writes).
// `create` uses the base (non-extended) client and is always called inside
// AccountProvisioningService's transaction (`tx`) — the tenant-guard
// extension has nothing to check at creation time anyway (arch §8: a
// SUPER_ADMIN caller has no TenantScope, so the extension skips).
@Injectable()
export class TrainersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.TrainerProfileCreateInput, tx?: Prisma.TransactionClient): Promise<TrainerProfile> {
    const client = tx ?? this.prisma;
    return client.trainerProfile.create({ data });
  }

  /** Not tenant-scoped by id — used by TrainerService.createTrainer to read back the just-created row by its unique userId. */
  async findByUserId(userId: string): Promise<TrainerProfile | null> {
    return this.prisma.trainerProfile.findUnique({ where: { userId } });
  }

  /**
   * Task 3.9 (api §4.1 "GET /trainers/:id"). Goes through `.extended` for
   * the tenant-guard runtime net (Layer 2, arch §8) — safe to call with any
   * `id` because TrainerService.assertOwnershipOrNotFound already
   * guarantees a TRAINER caller's `id` equals their own `ctx.trainerId`
   * before this is ever reached; see that method's comment.
   */
  async findById(id: string): Promise<TrainerProfile | null> {
    return this.prisma.extended.trainerProfile.findFirst({ where: { id } });
  }

  /**
   * Task 3.9 (api §4.1 "PATCH /trainers/:id"). Same ownership precondition
   * as findById. `tx` added in Task 8.1 (PortalBrandingService.updateBranding
   * needs the TrainerProfile update to commit atomically with the
   * MEDIA_LOGO_RESIZE outbox enqueue) — optional and last, per the plan's
   * global repository convention. When `tx` is provided the tenant-guard
   * extension (Layer 2) is deliberately NOT re-applied inside it (same
   * trade-off UsersRepository's tx-taking methods already make): Layer 1
   * (TrainerService/PortalBrandingService's own assertOwnershipOrNotFound)
   * has already run by the time any caller reaches this method, so Layer 2
   * would only be re-checking a precondition already guaranteed.
   */
  async update(id: string, data: Prisma.TrainerProfileUpdateInput, tx?: Prisma.TransactionClient): Promise<TrainerProfile> {
    const client = tx ?? this.prisma.extended;
    return client.trainerProfile.update({ where: { id }, data });
  }
}
