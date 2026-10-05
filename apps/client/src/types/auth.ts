// Mirrors apps/server/src/modules/auth/dto/auth-session-response.dto.ts and
// apps/server/prisma/schema.prisma's Role enum. arch §1: apps/client never
// talks to Postgres and has no build-time dependency on server code (every
// read/write goes through the NestJS API over HTTP), so this is a hand-kept
// mirror, not a shared import — same documented-duplication tradeoff as
// AvailabilityGrid's "Best Times" formatter (fe §5.4/§11.7), flagged there as
// a candidate for a future shared `packages/` workspace.
export type Role = 'SUPER_ADMIN' | 'TRAINER' | 'COACH' | 'PLAYER_PARENT';

export type AccountType = 'ADULT' | 'CHILD';

export interface UserSummaryDto {
  id: string;
  email: string;
  role: Role;
  accountType: AccountType;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  /** Only filled by GET /me/bootstrap (and kept in step after a profile save); drives the shell's user pill. */
  photoUrl?: string | null;
}

export interface AuthSessionResponseDto {
  accessToken: string;
  expiresIn: number;
  csrfToken: string;
  user: UserSummaryDto;
}
