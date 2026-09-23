import { Injectable } from '@nestjs/common';
import type { PlayerProfile, PlayerTrainerAssociation, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateAssociationInput {
  trainerId: string;
  playerProfileId: string;
  shareLinkId?: string;
}

// Task 5.7 (api §4.3 "GET /me/contexts"). One row per active
// `(playerProfile, trainer)` pair — the shape `AssociationsService.
// listContextsForUser` maps straight onto `ContextEntryDto`.
export interface ContextRow {
  playerProfileId: string;
  playerProfileName: string;
  isSelf: boolean;
  trainerId: string;
  trainerDisplayName: string;
  logoUrl: string | null;
  primaryColorHex: string | null;
  connectedAt: Date;
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

  /**
   * Task 4.1 stub, filled in for Task 4.7 (ASSOCIATE_EXISTING). An upsert,
   * not a plain `create`: the model's own `@@unique([trainerId,
   * playerProfileId])` constraint means a previously-`disconnect`ed pair
   * (Phase 5) already has a row for this identity, and reconnecting must
   * revive THAT row — `create` would violate the unique constraint. Task
   * 4.6's ANONYMOUS_REGISTRATION branch still uses the plain `create` above
   * (a brand-new PlayerProfile can never already have a row), so both
   * methods stay, each correct for its own caller's precondition.
   */
  async associate(input: CreateAssociationInput, tx?: Prisma.TransactionClient): Promise<PlayerTrainerAssociation> {
    const client = tx ?? this.prisma;
    return client.playerTrainerAssociation.upsert({
      where: { trainerId_playerProfileId: { trainerId: input.trainerId, playerProfileId: input.playerProfileId } },
      create: {
        trainer: { connect: { id: input.trainerId } },
        playerProfile: { connect: { id: input.playerProfileId } },
        ...(input.shareLinkId ? { shareLink: { connect: { id: input.shareLinkId } } } : {}),
      },
      update: {
        status: 'ACTIVE',
        connectedAt: new Date(),
        disconnectedAt: null,
        ...(input.shareLinkId ? { shareLink: { connect: { id: input.shareLinkId } } } : {}),
      },
    });
  }

  /**
   * Task 4.7 (ASSOCIATE_EXISTING ownership check). A full
   * `PlayerProfilesRepository` doesn't exist until Phase 5 — this narrow
   * lookup is enough for "does this profile belong to this caller" without
   * guessing at that module's eventual shape. `.extended` (when not already
   * inside a `tx`) so a soft-deleted profile is correctly invisible
   * (soft-delete.extension.ts covers `PlayerProfile`).
   */
  /** Task 5.8 — validates a bare `trainerId` (the "pick from My Trainers" branch, no ShareLink code involved). */
  async findTrainerById(trainerId: string, tx?: Prisma.TransactionClient): Promise<{ id: string } | null> {
    const client = tx ?? this.prisma;
    return client.trainerProfile.findUnique({ where: { id: trainerId }, select: { id: true } });
  }

  async findOwnedPlayerProfile(
    playerProfileId: string,
    ownerUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PlayerProfile | null> {
    const client = tx ? tx : this.prisma.extended;
    return client.playerProfile.findFirst({ where: { id: playerProfileId, accountUserId: ownerUserId } });
  }

  /**
   * Task 5.7 (api §4.3 "GET /me/contexts", FR-034). Every active
   * `(profile, trainer)` pair for an adult account — self + every child it
   * owns, per api §4.3's "Me" + "Children" grouping (the controller/service
   * does the grouping-by-profile; this returns the flat row set).
   */
  async findActiveContextsForAccount(accountUserId: string): Promise<ContextRow[]> {
    const rows = await this.prisma.extended.playerTrainerAssociation.findMany({
      where: { status: 'ACTIVE', playerProfile: { accountUserId } },
      include: { playerProfile: true, trainer: true },
      orderBy: { connectedAt: 'desc' },
    });
    return rows.map(toContextRow);
  }

  /**
   * Task 5.7 — `typ: CHILD` case: only that child's own list, no "Me"/parent
   * section (FR-034, arch §9.2's service-layer restriction).
   */
  async findActiveContextsForChild(childUserId: string): Promise<ContextRow[]> {
    const rows = await this.prisma.extended.playerTrainerAssociation.findMany({
      where: { status: 'ACTIVE', playerProfile: { childUserId } },
      include: { playerProfile: true, trainer: true },
      orderBy: { connectedAt: 'desc' },
    });
    return rows.map(toContextRow);
  }
}

function toContextRow(row: PlayerTrainerAssociation & { playerProfile: PlayerProfile; trainer: { businessName: string; logoUrl: string | null; primaryColorHex: string | null } }): ContextRow {
  return {
    playerProfileId: row.playerProfileId,
    playerProfileName: row.playerProfile.name,
    isSelf: row.playerProfile.isSelf,
    trainerId: row.trainerId,
    trainerDisplayName: row.trainer.businessName,
    logoUrl: row.trainer.logoUrl,
    primaryColorHex: row.trainer.primaryColorHex,
    connectedAt: row.connectedAt,
  };
}
