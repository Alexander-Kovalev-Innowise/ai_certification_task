import { create } from 'zustand';

import type { UserSummaryDto } from '../types/auth';

export interface AuthSession {
  accessToken: string;
  user: UserSummaryDto;
  expiresAt: number;
  isImpersonating?: boolean;
}

export interface AuthState {
  accessToken: string | null;
  user: UserSummaryDto | null;
  expiresAt: number | null;
  isImpersonating: boolean;
  setSession: (session: AuthSession) => void;
  clear: () => void;
}

const initialState = {
  accessToken: null,
  user: null,
  expiresAt: null,
  isImpersonating: false,
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
  setSession: ({ accessToken, user, expiresAt, isImpersonating = false }) =>
    set({ accessToken, user, expiresAt, isImpersonating }),
  clear: () => set({ ...initialState }),
}));
