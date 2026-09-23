import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

// Task 3.9 (api §4.1 "PATCH /trainers/:id"). Business details only —
// branding (logoUrl/primaryColorHex) is Task 8.1's separate
// PATCH /trainers/:id/branding endpoint (FR-071 vs FR-080, different
// validation and a different FR).
export class UpdateTrainerDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
