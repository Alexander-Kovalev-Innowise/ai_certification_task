import { z } from 'zod';

// api §0.10 PASSWORD_POLICY, reproduced exactly: min length 8 (enforced
// separately, not baked into the regex), at least one lowercase, one
// uppercase, one digit, no special-character requirement. Shared by every
// Phase 11 schema that sets/resets a password (reset-password, trainer
// setup /register, forced /change-password, anonymous ShareLink join) so
// the regex itself is defined once, not re-typed per file.
export const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export const passwordPolicySchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(PASSWORD_POLICY, 'Password must include an uppercase letter, a lowercase letter, and a number.');
