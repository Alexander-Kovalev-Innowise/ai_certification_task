import { IsBoolean, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

// Task 5.4 (api §4.3 "PATCH /player-profiles/:id"). Basics only — no
// `skillLevel` (trainer-set, per-association concept, Gap G-02, still
// open). `allowChildTokenSpendWithoutApproval` (FR-041) is on this DTO but
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
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @IsObject()
  emergencyContact?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  allowChildTokenSpendWithoutApproval?: boolean;
}
