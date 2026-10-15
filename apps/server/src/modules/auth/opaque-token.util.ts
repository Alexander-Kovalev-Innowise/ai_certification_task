import { createHash, randomBytes } from 'node:crypto';

// Shared by every opaque-token flow in this module: RefreshToken (Task
// 2.12/2.13), PasswordResetToken (Task 2.16/2.17/2.20), and
// EmailVerificationToken (Task 2.18) — arch §6.1's "opaque 256-bit random,
// SHA-256 hash stored at rest" pattern, reproduced once rather than per
// task. The raw value is what goes into the cookie/email link; only its
// hash is ever persisted.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashOpaqueToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
