import { IsString, Matches, MinLength } from 'class-validator';

import { PASSWORD_POLICY } from '../../auth/password-policy.const';

// POST /player-profiles/:id/child-login/reset-password — the guardian sets a
// new password for the child's login.
export class ResetChildLoginPasswordDto {
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY)
  password!: string;
}
