import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

import { PASSWORD_POLICY } from '../password-policy.const';

// Task 2.17 (api §1), reproduced verbatim (api §0.10 corrected the plan's
// original @MinLength(12) to 8).
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY)
  newPassword!: string;
}
