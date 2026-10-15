import type { MeBootstrapResponse } from '../../types/bootstrap';

// specs/frontend-design-spec.md §3 (2026-09-24 note) — shared prop shape for
// the four per-role dashboard shells the unified `/dashboard` route
// dispatches to. `ctx` is the raw `GET /me/bootstrap` response already
// narrowed to this shell's `role`; each shell reads its own slice of it.
export interface DashboardShellProps {
  ctx: MeBootstrapResponse;
}
