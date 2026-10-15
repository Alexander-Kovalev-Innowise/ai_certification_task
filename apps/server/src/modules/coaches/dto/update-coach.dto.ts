import type { CoachStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Task 4.13 (api §4.2 "PATCH /coaches/:id"). All fields optional, one DTO
// shared by both actors — the service (not this DTO) enforces which subset
// each caller may actually send (CoachService.updateCoach's
// `assertOnlyFields`), rejecting anything outside the caller's allowed set
// with `403 FIELD_NOT_ALLOWED_FOR_ROLE` rather than silently dropping it.
export class UpdateCoachDto {
  // Owning TRAINER only.
  @IsOptional()
  @IsIn(['ACTIVE', 'PENDING'])
  status?: 'ACTIVE' | 'PENDING';

  // The COACH themself only (FR-064).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  credentials?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  certifications?: string;

  @IsOptional()
  @IsBoolean()
  publicProfile?: boolean;
}

// Task 4.13. Plain fields, no `@Exclude`/`@Expose` stripping needed —
// `CoachProfile` carries nothing sensitive beyond what's already listed here.
export class CoachProfileResponseDto {
  id!: string;
  userId!: string;
  trainerId!: string;
  status!: CoachStatus;
  bio!: string | null;
  credentials!: string | null;
  certifications!: string | null;
  publicProfile!: boolean;
}

