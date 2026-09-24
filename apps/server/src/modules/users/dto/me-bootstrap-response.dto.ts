import { ContextEntryDto } from '../../associations/dto/context-list-response.dto';
import { UserSummaryDto } from '../../auth/dto/auth-session-response.dto';
import { CoachProfileResponseDto } from '../../coaches/dto/update-coach.dto';
import { PlayerProfileResponseDto } from '../../player-profiles/dto/player-profile-response.dto';
import { TrainerResponseDto } from '../../trainers/dto/trainer-response.dto';

// api §5 "GET /me/bootstrap — full per-role shapes (OQ-4)", reproduced
// verbatim — this is the aggregate endpoint arch §14/NFR-001 calls out as
// what collapses the dashboard's "5-request waterfall" into one round trip.
// Phase 9's DoD sweep found every phase had referenced this endpoint as
// existing infrastructure without any phase ever having built it; this file
// (plus the service method/controller route it backs) is that gap closed.
//
// A discriminated union on `role` (`@ApiExtraModels` + Swagger `oneOf` with
// `discriminator: {propertyName: 'role'}` on the controller route, api §5's
// own note) — exactly four members, matching the union's four literal
// `role` values. `PLAYER_PARENT`'s ADULT/CHILD split is NOT a fifth member:
// the spec names the union type itself as covering "both ADULT and CHILD
// typ — see accountType field", so both variants live on one
// `PlayerParentBootstrapDto` class, discriminated at the field level by
// `accountType` (ADULT-only fields are optional and simply absent on a
// CHILD response, never null-populated).

export class TrainerBrandingDto {
  logoUrl!: string | null;
  primaryColorHex!: string | null;
}

export class EmployingTrainerSummaryDto {
  id!: string;
  businessName!: string;
  logoUrl!: string | null;
  primaryColorHex!: string | null;
}

export class SuperAdminBootstrapDto {
  role!: 'SUPER_ADMIN';
  user!: UserSummaryDto;
}

export class TrainerBootstrapDto {
  role!: 'TRAINER';
  user!: UserSummaryDto;
  trainerProfile!: TrainerResponseDto;
  branding!: TrainerBrandingDto;
  coachCount!: number;
  activePlayerCount!: number;
}

export class CoachBootstrapDto {
  role!: 'COACH';
  user!: UserSummaryDto;
  coachProfile!: CoachProfileResponseDto;
  employingTrainer!: EmployingTrainerSummaryDto;
  availabilitySet!: boolean;
}

export class PlayerParentBootstrapDto {
  role!: 'PLAYER_PARENT';
  accountType!: 'ADULT' | 'CHILD';
  user!: UserSummaryDto;
  // ADULT only (self + every child profile the account owns).
  playerProfiles?: PlayerProfileResponseDto[];
  // CHILD only (own profile, per §9.2 — never a sibling's, never the guardian's own).
  playerProfile?: PlayerProfileResponseDto;
  contexts!: ContextEntryDto[];
  activeContext!: ContextEntryDto | null;
  // ADULT only — `VIEW_GUARDIAN_DATA` is CHILD-denied (capability.enum.ts), so a
  // CHILD response never carries this field at all, not even as `0`.
  pendingApprovalsCount?: number;
}

export type MeBootstrapResponseDto =
  | SuperAdminBootstrapDto
  | TrainerBootstrapDto
  | CoachBootstrapDto
  | PlayerParentBootstrapDto;
