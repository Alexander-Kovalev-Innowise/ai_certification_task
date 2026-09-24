import type { Role, UserSummaryDto } from './auth';

// Mirrors apps/server/src/modules/users/dto/me-bootstrap-response.dto.ts's
// MeBootstrapResponseDto — GET /me/bootstrap's discriminated-union response
// (api-spec §5), same hand-kept-mirror tradeoff as auth.ts (arch §1: no
// build-time dependency on server code).
//
// specs/frontend-design-spec.md §3 (2026-09-24 note) — this is the data
// source for the single unified `/dashboard` route: it only needs `role` to
// dispatch to the right shell component. The full per-role field set
// (`coachCount`, `trainerProfile`, `playerProfiles`, `pendingApprovalsCount`,
// etc. — see the DTO file above) is intentionally left untyped here rather
// than mirrored prematurely; each shell mirrors its own slice of the
// response when Phase 12+ builds that shell's real content.
export interface MeBootstrapResponse {
  role: Role;
  user: UserSummaryDto;
  [key: string]: unknown;
}
