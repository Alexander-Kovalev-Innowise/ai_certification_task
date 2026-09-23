import { randomUUID } from 'node:crypto';

import type { Role } from '@prisma/client';

// Task 1.9. Stub returning a plain claims object shaped exactly like the
// access-token payload arch §6.2 defines — real JWT signing is wired in once
// TokenService exists (Task 2.11), which will do roughly
// `jwt.sign(asUser(...), secret)`. Lets the security matrix in arch §7.3 be
// expressed as a table-driven test today (per arch §16), ahead of real auth.
export interface AuthTestClaims {
  sub: string;
  role: Role;
  typ: 'ADULT' | 'CHILD';
  gid: string | null;
  tid: string | null;
  tv: number;
  act?: { sub: string; role: Role; imp: string };
  jti: string;
  iat: number;
  exp: number;
}

export interface AsUserOptions {
  userId?: string;
  trainerId?: string | null;
  guardianUserId?: string | null;
  tokenVersion?: number;
  accountType?: 'ADULT' | 'CHILD';
  impersonation?: { actorUserId: string; actorRole: Role; logId: string };
  expiresInSeconds?: number;
}

export function asUser(role: Role, opts: AsUserOptions = {}): AuthTestClaims {
  const now = Math.floor(Date.now() / 1000);

  return {
    sub: opts.userId ?? randomUUID(),
    role,
    typ: opts.accountType ?? 'ADULT',
    gid: opts.guardianUserId ?? null,
    tid: opts.trainerId ?? null,
    tv: opts.tokenVersion ?? 0,
    act: opts.impersonation
      ? { sub: opts.impersonation.actorUserId, role: opts.impersonation.actorRole, imp: opts.impersonation.logId }
      : undefined,
    jti: randomUUID(),
    iat: now,
    exp: now + (opts.expiresInSeconds ?? 15 * 60),
  };
}
