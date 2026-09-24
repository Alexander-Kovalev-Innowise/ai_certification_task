import { Exclude, Expose } from 'class-transformer';

// Task 8.1 (api §4.1 "PATCH /trainers/:id/branding"). Not explicitly named
// in the plan's Task 8.1 file list (only update-branding.dto.ts is), but the
// response shape the spec documents — `{ logoUrl, primaryColorHex,
// derivedPalette: {...}, contrastWarning?: string }` — needs a home; this
// follows the same @Exclude/@Expose pattern as trainer-response.dto.ts
// rather than returning an untyped object literal from the service.
@Exclude()
export class DerivedPaletteDto {
  @Expose() primaryColorHex!: string;
  @Expose() recommendedTextColor!: '#FFFFFF' | '#000000';
  @Expose() contrastWithWhite!: number;
  @Expose() contrastWithBlack!: number;
  @Expose() meetsAA!: boolean;
}

@Exclude()
export class BrandingResponseDto {
  @Expose() logoUrl!: string | null;
  @Expose() primaryColorHex!: string | null;
  @Expose() derivedPalette!: DerivedPaletteDto | null;
  // Non-blocking (OQ-7) — present only when primaryColorHex fails AA against
  // both white and black text. Never causes the PATCH to be rejected.
  @Expose() contrastWarning?: string;
}
