import { IsArray, IsDateString, IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';

// Task 5.1 (api §4.3 "POST /player-profiles", FR-030/FR-031), reproduced
// verbatim from the plan/spec. Child profiles only — a self profile
// (isSelf: true) is created exclusively by AccountProvisioningService /
// ShareLinkRedemptionService at registration time (Tasks 2.10/4.6), never
// through this endpoint. `dateOfBirth` is validated for shape here;
// PlayerProfileService derives age and enforces the 1-18 range (BR
// "1-18 years") — that check needs the current date, not expressible as a
// class-validator decorator alone.
export class CreateChildProfileDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsIn(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'])
  gender!: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  school?: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  // FR-031's trainer-selection checklist — if provided, PlayerProfileService
  // creates one PlayerTrainerAssociation per id in the same transaction as
  // the profile itself.
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  trainerIds?: string[];
}
