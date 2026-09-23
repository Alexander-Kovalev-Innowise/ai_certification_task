import { IsObject, IsOptional, IsPhoneNumber, IsString, IsUrl, MaxLength } from 'class-validator';

// Task 2.22 (api §3), reproduced verbatim. Common fields only — role-specific
// fields (bio, business name, etc.) go through their owning controller per
// FR-080 (TrainersController/CoachesController/PlayerProfilesController,
// Phase 3/4, not built yet).
//
// The narrower CHILD-login whitelist (photoUrl/notificationPrefs only) is a
// service-layer check (UsersService), not expressed here — EDIT_OWN_PROFILE
// is not in CHILD_DENIED, so the guard lets the request through; the DTO
// itself is shared by both ADULT and CHILD callers.
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, boolean>;
}
