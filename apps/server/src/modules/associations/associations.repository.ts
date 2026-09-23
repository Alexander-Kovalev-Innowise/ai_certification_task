import { Injectable } from '@nestjs/common';
import type { PlayerTrainerAssociation, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateAssociationInput {
  trainerId: string;
  playerProfileId: string;
  shareLinkId?: string;
}

// Task 4.1 (arch §2 — associations promoted to its own module to break a
// share-links <-> player-profiles cycle). Repository-only for now: full
// service logic (idempotency messaging, removal-with-cascade, the
// trainer-facing roster) is Phase 5/`AssociationsController`'s job. This
// task exists so Phase 4's redemption flows (Tasks 4.6/4.7/4.9) have
// something to call today.
//
// `create`/`disconnect` use the base (non-extended) Prisma surface — same
// convention as TrainersRepository.create: writes made inside a caller's own
// `$transaction` (redemption's `tx`) don't need the tenant-guard extension's
// runtime net, and `create`'s `args` has no `where` for that extension to
// even inspect. `findActive` goes through `.extended` — PlayerTrainerAssociation
// is one of the five tenant-owned models (arch §8 Layer 2), so any caller
// reached under an ALS TenantScope gets the same "missing/wrong trainerId
// throws" backstop the trainers module already relies on; callers with no
// active scope (e.g. Phase 4's @Public() redemption flows) are unaffected
// (the extension skips when no scope is published, tenant-guard.extension.ts).
//
// No `deletedAt` filtering here (soft-delete.extension.ts only covers User
// and PlayerProfile — PlayerTrainerAssociation manages removal via
// `status`/`disconnectedAt` instead, a deliberate Phase 1 finding recorded in
// that extension's own file comment).
@Injectable()
export class AssociationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAssociationInput, tx?: Prisma.TransactionClient): Promise<PlayerTrainerAssociation> {
    const client = tx ?? this.prisma;
    return client.playerTrainerAssociation.create({
      data: {
        trainer: { connect: { id: input.trainerId } },
        playerProfile: { connect: { id: input.playerProfileId } },
        ...(input.shareLinkId ? { shareLink: { connect: { id: input.shareLinkId } } } : {}),
      },
    });
  }

  /**
   * The active `(trainer, playerProfile)` pair, or `null`. Backs the
   * idempotency checks Tasks 4.6/4.7 need ("already-connected -> 200 with
   * the existing row, not an error") — the `@@unique([trainerId,
   * playerProfileId])` constraint on the model makes this pair the natural
   * identity to look up by, rather than a synthetic id.
   */
  async findActive(
    trainerId: string,
    playerProfileId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PlayerTrainerAssociation | null> {
    const client = tx ? tx : this.prisma.extended;
    return client.playerTrainerAssociation.findFirst({ where: { trainerId, playerProfileId, status: 'ACTIVE' } });
  }

  /**
   * Soft-removal only — `status: 'INACTIVE'` + `disconnectedAt`, never a row
   * delete (matches the model's own shape; see the class-level comment on
   * why there is no `deletedAt` column here to set instead).
   */
  async disconnect(id: string, tx?: Prisma.TransactionClient): Promise<PlayerTrainerAssociation> {
    const client = tx ?? this.prisma;
    return client.playerTrainerAssociation.update({
      where: { id },
      data: { status: 'INACTIVE', disconnectedAt: new Date() },
    });
  }
}
