import { Injectable } from '@nestjs/common';
import type { PlayerProfile, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface TrainerRowForProfile {
  trainerId: string;
  businessName: string;
  logoUrl: string | null;
  connectedAt: Date;
  status: string;
}

// Task 5.1, extended in Tasks 5.2-5.5. `PlayerProfile` is not one of the
// five tenant-owned models (tenant-guard.extension.ts's
// TENANT_ID_FIELD_BY_MODEL) — it's owned by the account, not a trainer — so
// every read here goes through `.extended` only for the soft-delete filter
// (soft-delete.extension.ts covers `User`/`PlayerProfile`), never for
// tenant-guard's runtime net.
@Injectable()
export class PlayerProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.PlayerProfileCreateInput, tx?: Prisma.TransactionClient): Promise<PlayerProfile> {
    const client = tx ?? this.prisma;
    return client.playerProfile.create({ data });
  }

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<PlayerProfile | null> {
    const client = tx ? tx : this.prisma.extended;
    return client.playerProfile.findFirst({ where: { id } });
  }

  /** Task 5.2 — adult family list: caller's own self profile + every child profile they own. */
  async listForAccount(accountUserId: string): Promise<PlayerProfile[]> {
    return this.prisma.extended.playerProfile.findMany({
      where: { accountUserId },
      orderBy: [{ isSelf: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Task 5.2 — a CHILD login's list is exactly its own profile, never a
   * sibling's or the guardian's self profile (arch §9.2: "a CHILD context
   * can only resolve PlayerProfile rows where childUserId = auth.userId").
   */
  async findByChildUserId(childUserId: string): Promise<PlayerProfile | null> {
    return this.prisma.extended.playerProfile.findFirst({ where: { childUserId } });
  }

  /** Task 5.1/5.2 — how many active trainer associations a profile has, for the list view's `trainerCount` summary. */
  async countActiveTrainers(playerProfileId: string): Promise<number> {
    return this.prisma.playerTrainerAssociation.count({ where: { playerProfileId, status: 'ACTIVE' } });
  }

  async update(id: string, data: Prisma.PlayerProfileUpdateInput): Promise<PlayerProfile> {
    return this.prisma.playerProfile.update({ where: { id }, data });
  }

  /**
   * Task 5.1 — FR-030's non-blocking duplicate check: another profile under
   * the same account with the same name and date of birth. Deliberately
   * excludes the profile currently being created (there is none yet at
   * create time) and is case-insensitive on `name`.
   */
  async findDuplicateSibling(accountUserId: string, name: string, dateOfBirth: Date): Promise<PlayerProfile | null> {
    return this.prisma.extended.playerProfile.findFirst({
      where: { accountUserId, dateOfBirth, name: { equals: name, mode: 'insensitive' } },
    });
  }

  /**
   * Task 5.5 (api §4.3 "GET /player-profiles/:id/trainers", FR-032). Joins
   * `PlayerTrainerAssociation` -> `TrainerProfile` for the per-child trainer
   * list with dates — every association regardless of status, so a removed
   * trainer still shows up with `status: 'INACTIVE'` rather than silently
   * disappearing (FR-032's "with dates" implies history, not just the
   * current roster).
   */
  async findTrainersForProfile(playerProfileId: string): Promise<TrainerRowForProfile[]> {
    const rows = await this.prisma.playerTrainerAssociation.findMany({
      where: { playerProfileId },
      include: { trainer: true },
      orderBy: { connectedAt: 'desc' },
    });

    return rows.map((row) => ({
      trainerId: row.trainerId,
      businessName: row.trainer.businessName,
      logoUrl: row.trainer.logoUrl,
      connectedAt: row.connectedAt,
      status: row.status,
    }));
  }
}
