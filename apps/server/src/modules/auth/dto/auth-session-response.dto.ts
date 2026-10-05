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
  // Optional: only GET /me/bootstrap fills it (drives the shell's user pill).
  photoUrl?: string | null;
}

// api §1 shape, plus `csrfToken` (deviation, documented in
// specs/api-designer-spec.md and architect-architecture.md): the spec's
// original "double-submit CSRF cookie, client JS reads it via
// document.cookie" design only works when client and server share an
// origin. This project's actual architecture has them on separate origins
// (apps/client :3001, apps/server :3000) — document.cookie on the client's
// page can never see a cookie the server set on its own, different origin,
// so the client could never actually echo the CSRF cookie back in
// X-CSRF-Token, and every refresh/logout call failed CSRF validation
// unconditionally. Returning the same token value in the response body too
// lets the client store it (in-memory, alongside the access token) and use
// that instead of trying to read the cookie. The cookie itself is unchanged
// server-side — the double-submit *validation* still compares cookie vs.
// header exactly as before, only the client's *source* for the header
// value changed.
export class AuthSessionResponseDto {
  accessToken!: string;
  expiresIn!: number;
  csrfToken!: string;
  user!: UserSummaryDto;
}
