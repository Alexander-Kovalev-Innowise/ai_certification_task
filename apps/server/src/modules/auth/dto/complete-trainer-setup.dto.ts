import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

import { PASSWORD_POLICY } from '../password-policy.const';

// Task 2.20 (api §1). NOT public self-registration (BR-005) — completes a
// Super-Admin-provisioned trainer's setup link (Task 3.8, doesn't exist
// yet — see auth.service.ts's completeTrainerSetup for how this is
// implemented/tested against a manually-seeded token in the meantime).
export class CompleteTrainerSetupDto {
  @IsString()
  @IsNotEmpty()
  setupToken!: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY)
  password!: string;
}
