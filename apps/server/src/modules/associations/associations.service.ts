import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { buildPaginatedResponse, decodeCursor } from '../../shared/http/pagination.dto';
import type { KeysetCursor } from '../../shared/http/pagination.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { resolveShareLinkInvalidReason } from '../share-links/share-link.service';
import { ShareLinksRepository } from '../share-links/share-links.repository';

import { AssociationsRepository, ContextRow, PlayerProfileWithAvailability } from './associations.repository';
import { formatAvailabilitySummary } from './availability-summary.formatter';
import { ContextEntryDto, ContextListResponseDto } from './dto/context-list-response.dto';
import type { ListRosterQueryDto } from './dto/list-roster-query.dto';
import { RosterPageDto, RosterRowDto } from './dto/roster-row.dto';

export interface AddTrainerAssociationResult {
  statusCode: number;
  body: {
    id: string;
    trainerId: string;
    playerProfileId: string;
    status: 'ACTIVE';
    connectedAt: string;
    alreadyConnected: boolean;
  };
}

// Task 5.7, first method (`listContextsForUser`) — extended in Tasks
// 5.8-5.10 (`addTrainerAssociation`, `removeTrainerAssociation`,
// `listRosterForTrainer`). Named `AssociationsService` here (not literally
// `PlayerTrainerAssociationService`, the plan's prose name for the same
// responsibility) to match this codebase's `<module>.service.ts` /
// `<Module>Service` naming convention used by every other module
// (CoachService, ShareLinkService, ...). `ShareLinksRepository` is imported
// directly (not via a `ShareLinksModule` import) — `ShareLinksModule`
// already imports `AssociationsModule` for `AssociationsRepository`, so
// importing it back here would be circular; same
// import-the-class-directly-and-re-declare-as-a-provider workaround
// `UsersModule` already uses for `RefreshTokenRepository`.
@Injectable()
export class AssociationsService {
  private readonly logger = new Logger(AssociationsService.name);

  constructor(
    private readonly associationsRepository: AssociationsRepository,
    private readonly shareLinksRepository: ShareLinksRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Task 5.7 (api §4.3 "GET /me/contexts", FR-034). Adult: every
   * `(profile, trainer)` active pair grouped by profile ("Me" + "Children").
   * `typ: CHILD`: only that child's own list, no "Me"/parent section.
   */
  async listContextsForUser(ctx: AuthContext): Promise<ContextListResponseDto> {
    const rows =
      ctx.accountType === 'CHILD'
        ? await this.associationsRepository.findActiveContextsForChild(ctx.userId)
        : await this.associationsRepository.findActiveContextsForAccount(ctx.userId);

    return { contexts: rows.map(toEntry) };
  }

  /**
   * Task 5.8 (api §4.3 "POST /player-profiles/:id/trainers", FR-032 "Add
   * Trainer"). CHILD tokens never reach this method
   * (`MANAGE_TRAINER_ASSOCIATIONS` is in `CHILD_DENIED`). Body is oneOf
   * `{shareLinkCode}` / `{trainerId}` — exactly one, checked here (not
   * declaratively, same reasoning as `RedeemShareLinkDto`). Idempotent per
   * `(trainer, profile)`: an already-active pair returns `200` with the
   * existing row (`alreadyConnected: true`), never a `409`.
   */
  async addTrainerAssociation(
    ctx: AuthContext,
    playerProfileId: string,
    dto: { shareLinkCode?: string; trainerId?: string },
  ): Promise<AddTrainerAssociationResult> {
    const hasCode = dto.shareLinkCode !== undefined;
    const hasTrainerId = dto.trainerId !== undefined;
    if (hasCode === hasTrainerId) {
      throw new BadRequestException({
        message: 'Exactly one of shareLinkCode or trainerId is required',
        errorCode: 'VALIDATION_ERROR',
        details: [{ field: 'shareLinkCode|trainerId', message: 'Provide exactly one of shareLinkCode or trainerId' }],
      });
    }

    const profile = await this.associationsRepository.findOwnedPlayerProfile(playerProfileId, ctx.userId);
    if (!profile) {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }

    let trainerId: string;
    let shareLinkId: string | undefined;

    if (dto.trainerId) {
      // Authorization: a parent may only add a trainer they are already
      // actively connected to (through any of their profiles) - otherwise any
      // trainer UUID would be attachable. 404 for both "unknown" and "not
      // yours" so existence is not disclosed.
      const trainer = await this.associationsRepository.findTrainerById(dto.trainerId);
      const authorized =
        trainer !== null && (await this.associationsRepository.accountHasActiveAssociation(ctx.userId, dto.trainerId));
      if (!authorized) {
        throw new NotFoundException({ message: 'Trainer not found', errorCode: 'NOT_FOUND' });
      }
      trainerId = dto.trainerId;
    } else {
      const link = await this.shareLinksRepository.findByCode(dto.shareLinkCode!);
      if (!link) {
        throw new NotFoundException({ message: 'Unknown ShareLink code', errorCode: 'NOT_FOUND' });
      }
      if (link.type !== 'PLAYER_STATIC' || resolveShareLinkInvalidReason(link) !== null) {
        throw new NotFoundException({ message: 'ShareLink is no longer available', errorCode: 'NOT_FOUND' });
      }
      trainerId = link.trainerId;
      shareLinkId = link.id;
    }

    const existing = await this.associationsRepository.findActive(trainerId, playerProfileId);
    // Redeeming a code counts as a use of the link; the association and the
    // counter commit together.
    const association = await this.prisma.$transaction(async (tx) => {
      const row = await this.associationsRepository.associate({ trainerId, playerProfileId, shareLinkId }, tx);
      if (shareLinkId) {
        await this.shareLinksRepository.incrementUseCount(shareLinkId, tx);
      }
      return row;
    });

    return {
      statusCode: existing ? 200 : 201,
      body: {
        id: association.id,
        trainerId,
        playerProfileId,
        status: 'ACTIVE',
        connectedAt: association.connectedAt.toISOString(),
        alreadyConnected: existing !== null,
      },
    };
  }

  /**
   * Task 5.9 (api §4.3 "DELETE /player-profiles/:id/trainers/:trainerId",
   * FR-032 "Remove Child from Trainer"). CHILD tokens never reach this
   * method (same deny-list capability as Task 5.8). Soft-delete-with-cascade
   * unconditionally on call — the client is expected to have already shown
   * the "this cancels upcoming RSVPs" confirmation; there is no
   * server-side confirmation step, and RSVP cancellation itself is an
   * Epic-02 concern out of scope here beyond marking the association
   * `INACTIVE` (api §4.3).
   */
  async removeTrainerAssociation(ctx: AuthContext, playerProfileId: string, trainerId: string): Promise<void> {
    const profile = await this.associationsRepository.findOwnedPlayerProfile(playerProfileId, ctx.userId);
    if (!profile) {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }

    const association = await this.associationsRepository.findActive(trainerId, playerProfileId);
    if (!association) {
      throw new NotFoundException({ message: 'Trainer association not found', errorCode: 'NOT_FOUND' });
    }

    await this.associationsRepository.disconnect(association.id);
  }

  /**
   * Task 5.10 (api §4.3 "GET /trainers/:id/players", FR-070 gap-fill §8.8).
   * Own tenant for TRAINER, any for SUPER_ADMIN — same ownership pattern
   * CoachService.listCoaches/ShareLinkService.listShareLinks already use;
   * checked BEFORE the repository call so a mismatched `:id` never reaches
   * the tenant-guard extension. `dayOfWeek`/`startTime`/`endTime` narrow to
   * players with at least one matching available slot — in the DATABASE, with
   * a real `(connectedAt, id)` keyset cursor (US-01.09). The page also
   * carries `availableCount`/`totalCount` for the "X out of Y" line.
   */
  async listRosterForTrainer(ctx: AuthContext, trainerId: string, query: ListRosterQueryDto): Promise<RosterPageDto> {
    this.assertOwnershipOrNotFound(ctx, trainerId);

    const limit = query.limit ?? 50;
    let cursor: KeysetCursor | undefined;
    if (query.cursor) {
      try {
        cursor = decodeCursor(query.cursor);
      } catch {
        throw new BadRequestException({
          message: 'Invalid pagination cursor',
          errorCode: 'VALIDATION_ERROR',
          details: [{ field: 'cursor', message: 'Invalid pagination cursor' }],
        });
      }
    }
    const filter = { dayOfWeek: query.dayOfWeek, startTime: query.startTime, endTime: query.endTime };
    const filterActive = query.dayOfWeek !== undefined;

    const [rows, totalCount, availableCount] = await Promise.all([
      this.associationsRepository.listActivePlayersPage(trainerId, { filter, limit, cursor }),
      this.associationsRepository.countActivePlayers(trainerId),
      filterActive ? this.associationsRepository.countActivePlayers(trainerId, filter) : Promise.resolve(undefined),
    ]);

    const page = buildPaginatedResponse(rows, limit, (row) => ({ createdAt: row.connectedAt.toISOString(), id: row.id }));
    return {
      items: page.items.map((row) => toRosterRow(row.playerProfile)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      availableCount: availableCount ?? totalCount,
      totalCount,
    };
  }

  /**
   * Epic §3 "Manage own organization users": the trainer removes a player from
   * their roster. Soft — the association becomes `INACTIVE` with
   * `disconnectedAt` (history kept; the family can re-join via a share link).
   * 404 (never 403) for another tenant or for a player not actively on the
   * roster.
   */
  async removePlayerFromRoster(ctx: AuthContext, trainerId: string, playerProfileId: string): Promise<void> {
    this.assertOwnershipOrNotFound(ctx, trainerId);

    const association = await this.associationsRepository.findActive(trainerId, playerProfileId);
    if (!association) {
      throw new NotFoundException({ message: 'Player not found on this roster', errorCode: 'NOT_FOUND' });
    }

    await this.associationsRepository.disconnect(association.id);
    this.logger.log(
      JSON.stringify({
        event: 'trainer.player.removed',
        trainerId,
        playerProfileId,
        associationId: association.id,
        removedBy: ctx.userId,
      }),
    );
  }

  /** Mirrors CoachService's own ownership check (api §4.1 footnote) — 404, never 403 (arch §8 Layer 3). */
  private assertOwnershipOrNotFound(ctx: AuthContext, trainerId: string): void {
    if (ctx.role === 'SUPER_ADMIN') {
      return;
    }
    if (ctx.role === 'TRAINER' && ctx.trainerId === trainerId) {
      return;
    }
    throw new NotFoundException({ message: 'Trainer not found', errorCode: 'NOT_FOUND' });
  }
}

function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

function toRosterRow(player: PlayerProfileWithAvailability): RosterRowDto {
  return {
    playerProfileId: player.id,
    name: player.name,
    age: calculateAge(player.dateOfBirth),
    availabilitySummary: formatAvailabilitySummary(player.availability),
  };
}

function toEntry(row: ContextRow): ContextEntryDto {
  return {
    playerProfileId: row.playerProfileId,
    playerProfileName: row.playerProfileName,
    isSelf: row.isSelf,
    trainerId: row.trainerId,
    trainerDisplayName: row.trainerDisplayName,
    logoUrl: row.logoUrl,
    primaryColorHex: row.primaryColorHex,
    connectedAt: row.connectedAt.toISOString(),
  };
}
