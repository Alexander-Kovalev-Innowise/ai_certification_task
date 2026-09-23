import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { resolveShareLinkInvalidReason } from '../share-links/share-link.service';
import { ShareLinksRepository } from '../share-links/share-links.repository';

import { AssociationsRepository, ContextRow, PlayerProfileWithAvailability } from './associations.repository';
import { formatAvailabilitySummary } from './availability-summary.formatter';
import { ContextEntryDto, ContextListResponseDto } from './dto/context-list-response.dto';
import type { ListRosterQueryDto } from './dto/list-roster-query.dto';
import { RosterRowDto } from './dto/roster-row.dto';

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
  constructor(
    private readonly associationsRepository: AssociationsRepository,
    private readonly shareLinksRepository: ShareLinksRepository,
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
      const trainer = await this.associationsRepository.findTrainerById(dto.trainerId);
      if (!trainer) {
        throw new NotFoundException({ message: 'Trainer not found', errorCode: 'NOT_FOUND' });
      }
      trainerId = dto.trainerId;
    } else {
      const link = await this.shareLinksRepository.findByCode(dto.shareLinkCode!);
      if (!link) {
        throw new NotFoundException({ message: 'Unknown ShareLink code', errorCode: 'NOT_FOUND' });
      }
      if (resolveShareLinkInvalidReason(link) !== null) {
        throw new NotFoundException({ message: 'ShareLink is no longer available', errorCode: 'NOT_FOUND' });
      }
      trainerId = link.trainerId;
      shareLinkId = link.id;
    }

    const existing = await this.associationsRepository.findActive(trainerId, playerProfileId);
    const association = await this.associationsRepository.associate({ trainerId, playerProfileId, shareLinkId });

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
   * the tenant-guard extension (same reasoning those methods document).
   * `dayOfWeek`/`startTime`/`endTime` narrow to players with at least one
   * matching available slot; pagination is an in-memory slice, same
   * deliberate simplification CoachService.listCoaches uses for its own
   * bounded roster.
   */
  async listRosterForTrainer(
    ctx: AuthContext,
    trainerId: string,
    query: ListRosterQueryDto,
  ): Promise<PaginatedResponseDto<RosterRowDto>> {
    this.assertOwnershipOrNotFound(ctx, trainerId);

    const players = await this.associationsRepository.listActivePlayersForTrainer(trainerId);
    const filtered = players.filter((player) => matchesFilter(player, query));
    const rows = filtered.map((player) => toRosterRow(player));

    const limit = query.limit ?? 50;
    return { items: rows.slice(0, limit), nextCursor: null, hasMore: rows.length > limit };
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

function matchesFilter(player: PlayerProfileWithAvailability, query: ListRosterQueryDto): boolean {
  if (query.dayOfWeek === undefined) {
    return true;
  }
  return player.availability.some((slot) => {
    if (!slot.isAvailable || slot.dayOfWeek !== query.dayOfWeek) {
      return false;
    }
    if (query.startTime === undefined || query.endTime === undefined) {
      return true;
    }
    return slot.startTime < query.endTime && slot.endTime > query.startTime;
  });
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
