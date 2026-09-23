import { IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsPhoneNumber, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

import { PASSWORD_POLICY } from '../../auth/password-policy.const';

const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;

// Task 4.6, extended in Task 4.7 (ASSOCIATE_EXISTING's `subjectProfileIds`).
// One DTO for all five `POST /share-links/:code/redeem` branches (api §4.4)
// — the branch is resolved server-side from auth state + link type, not
// from the request body, so there is no way to know ahead of the global
// `ValidationPipe`'s `forbidNonWhitelisted: true` which fields a given
// request "should" carry. Every field is therefore optional here;
// per-branch required-field validation happens in
// ShareLinkRedemptionService (same "data-dependent, so it lives in the
// service" convention AuthService.changePassword's `currentPassword`
// already established for this codebase), reported as the same 400
// VALIDATION_ERROR shape the DTO layer itself would have produced.
export class RedeemShareLinkDto {
  // ANONYMOUS_REGISTRATION (Task 4.6)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  // ANONYMOUS_REGISTRATION (Task 4.6) + COACH_ACCEPT anonymous case (Task 4.9)
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY)
  password?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  playerName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @IsBoolean()
  isSelf?: boolean;

  // ASSOCIATE_EXISTING (Task 4.7, FR-021 checklist)
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  subjectProfileIds?: string[];
}
