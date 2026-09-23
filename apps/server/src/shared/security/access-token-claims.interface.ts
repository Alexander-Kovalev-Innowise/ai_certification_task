import type { Role } from '@prisma/client';

// arch §6.2, verbatim. Shared between JwtAuthGuard (Task 2.4, verifies +
// reads these) and TokenService (Task 2.11, issues them) so the claim shape
// is defined exactly once.
export interface AccessTokenClaims {
  sub: string; // effective user id
  role: Role; // effective role — RolesGuard reads this
  typ: 'ADULT' | 'CHILD';
  gid: string | null; // guardian user id, child only
  tid: string | null; // TRAINER: own id. COACH: employing trainer. else null
  tv: number; // tokenVersion, §6.3
  act?: { sub: string; role: Role; imp: string }; // impersonation actor claim, RFC 8693
  jti: string;
  iat: number;
  exp: number;
}
