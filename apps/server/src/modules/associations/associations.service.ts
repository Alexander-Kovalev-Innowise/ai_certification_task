import { Injectable } from '@nestjs/common';

import type { AuthContext } from '../../shared/security/auth-context.interface';

import { AssociationsRepository, ContextRow } from './associations.repository';
import { ContextEntryDto, ContextListResponseDto } from './dto/context-list-response.dto';

// Task 5.7, first method (`listContextsForUser`) — extended in Tasks
// 5.8-5.10 (`addTrainerAssociation`, `removeTrainerAssociation`,
// `listRosterForTrainer`). Named `AssociationsService` here (not literally
// `PlayerTrainerAssociationService`, the plan's prose name for the same
// responsibility) to match this codebase's `<module>.service.ts` /
// `<Module>Service` naming convention used by every other module
// (CoachService, ShareLinkService, ...).
@Injectable()
export class AssociationsService {
  constructor(private readonly associationsRepository: AssociationsRepository) {}

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
