import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { PASSWORD_POLICY } from '../../auth/password-policy.const';

// POST /player-profiles/:id/child-login — the guardian chooses the child's
// sign-in email and an initial password (same policy as every other password).
export class CreateChildLoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY)
  password!: string;
}
