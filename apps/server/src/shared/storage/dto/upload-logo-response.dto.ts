import { Exclude, Expose } from 'class-transformer';

// Task 8.2 (api §4.1: "Multipart or two-step (POST logo to shared/storage
// first, then this PATCH with the resulting URL — matches FileStorageService
// port design)"). `logoUrl` is what the caller passes as
// UpdateBrandingDto.logoUrl in the follow-up PATCH /trainers/:id/branding.
@Exclude()
export class UploadLogoResponseDto {
  @Expose() logoUrl!: string;
}
