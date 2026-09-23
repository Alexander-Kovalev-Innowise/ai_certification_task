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
}
