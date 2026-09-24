import { IsBoolean, IsOptional, IsUrl, Matches } from 'class-validator';

// Task 8.1 (api §4.1 "PATCH /trainers/:id/branding", FR-071/OQ-7).
// Reproduced verbatim from api-designer-spec.md — branding is a separate DTO
// from UpdateTrainerDto (business details) because it has different
// validation and a different FR (FR-071 vs FR-080).
export class UpdateBrandingDto {
  @IsOptional()
  @IsUrl()
  logoUrl?: string; // pre-uploaded via shared/storage (Task 8.2's POST /storage/logo)

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColorHex?: string;

  @IsOptional()
  @IsBoolean()
  resetToDefault?: boolean;
}
