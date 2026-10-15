import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

import { IsPhotoUrl } from '../../../shared/http/asset-url.decorator';

// Task 5.4 (api §4.3 "PATCH /player-profiles/:id"). Basics only — no
// `skillLevel` (read-only here; the trainer sets it via
// PATCH /trainers/:id/players/:playerProfileId/skill-level).
// `allowChildTokenSpendWithoutApproval` (FR-041) is on this DTO but
// is owning-adult-only even though it lives on "the child's" profile — the
// service rejects it for `typ: CHILD` (`403 CHILD_FIELD_NOT_EDITABLE`),
// same pattern as UpdateMeDto's CHILD_NOT_EDITABLE_FIELDS (Task 2.22).
export class UpdatePlayerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  school?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  jerseyNumber?: string;

  @IsOptional()
  @IsPhotoUrl()
  photoUrl?: string | null; // null clears the photo

  @IsOptional()
  @IsObject()
  emergencyContact?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  allowChildTokenSpendWithoutApproval?: boolean;
}
