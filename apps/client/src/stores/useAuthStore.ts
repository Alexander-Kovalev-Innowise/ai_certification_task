import { create } from 'zustand';

import type { UserSummaryDto } from '../types/auth';

export interface AuthSession {
  accessToken: string;
  user: UserSummaryDto;
  expiresAt: number;
  isImpersonating?: boolean;
  // Double-submit CSRF token (spec §13). The `csrf` cookie is set on
  // apps/server's own origin (:3000), which apps/client's document.cookie
  // (origin :3001) can never read — cookie JS-access is strictly per-origin,
  // unlike cookie transmission on a credentialed fetch. The server therefore
  // also returns the same value in the login/refresh response body (see
  // auth-session-response.dto.ts), kept here in memory only and echoed back as
  // X-CSRF-Token on POST /auth/logout, where the server enforces
  // header === cookie. After a reload it is empty until the boot-time
  // POST /auth/refresh (Origin-verified, token not required) returns it.
  // Empty for impersonation sessions (they have no csrf pair of their own).
  csrfToken: string;
}

export interface AuthState {
  accessToken: string | null;
  user: UserSummaryDto | null;
  expiresAt: number | null;
  isImpersonating: boolean;
  csrfToken: string | null;
  setSession: (session: AuthSession) => void;
  clear: () => void;
}

const initialState = {
  accessToken: null,
  user: null,
  expiresAt: null,
  isImpersonating: false,
  csrfToken: null,
} satisfies Omit<AuthState, 'setSession' | 'clear'>;

// fe §6.1 — a small hand-rolled Zustand store, NOT React Context. Context
// re-renders every consumer on every token refresh (every 15 min at
// minimum); Zustand's selector-based subscription lets components that only
// need e.g. `isAuthenticated`/`role` skip re-rendering when only the raw
// token string changes.
//
// NEVER persisted — no `zustand/persist` middleware, ever. Persisting the
// access token to localStorage/sessionStorage is exactly the XSS exposure
// architecture §6.1 rules out; `clear()` and every setter below only ever
// call Zustand's in-memory `set`, nothing browser-storage-backed.
export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,
  setSession: ({ accessToken, user, expiresAt, isImpersonating = false, csrfToken }) =>
    set({ accessToken, user, expiresAt, isImpersonating, csrfToken }),
  clear: () => set({ ...initialState }),
}));
