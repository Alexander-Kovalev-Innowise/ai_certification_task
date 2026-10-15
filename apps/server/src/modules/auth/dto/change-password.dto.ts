import { IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

import { PASSWORD_POLICY } from '../password-policy.const';

// Task 2.19 (api §1). `currentPassword` is optional at the DTO level only —
// whether it's actually required is data-dependent (mustChangePassword on
// the caller's own row), so that check lives in the service, not here.
export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY)
  newPassword!: string;
}
