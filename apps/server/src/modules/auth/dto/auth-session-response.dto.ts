import type { Role } from '@prisma/client';

// api §1 references `UserSummaryDto` in several response shapes without
// spelling out its fields anywhere in the spec — this is the minimal set
// every one of those call sites actually needs: enough to identify the
// user and immediately drive the forced-password-change redirect
// (`user.mustChangePassword`, called out explicitly at api §1's
// POST /auth/login).
export class UserSummaryDto {
  id!: string;
  email!: string;
  role!: Role;
  accountType!: 'ADULT' | 'CHILD';
  firstName!: string;
  lastName!: string;
  mustChangePassword!: boolean;
}

// api §1, verbatim shape.
export class AuthSessionResponseDto {
  accessToken!: string;
  expiresIn!: number;
  user!: UserSummaryDto;
}
