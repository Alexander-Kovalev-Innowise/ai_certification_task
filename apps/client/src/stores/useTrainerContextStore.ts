import { create } from 'zustand';

// fe §5.2/§6.3 — the active-context cookie is deliberately NOT httpOnly, so
// both client JS (this store, on load) and a server component (to pre-set
// the X-Trainer-Context header on the initial request) can read it.
export const ACTIVE_TRAINER_COOKIE = 'activeTrainerId';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

function writeCookie(name: string, value: string | null): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (value === null) {
    document.cookie = `${name}=; path=/; max-age=0`;
    return;
  }
  // The selection is UX-only (arch §8's closing paragraph — the server
  // re-validates the header against an ACTIVE PlayerTrainerAssociation on
  // every request regardless of what the client last selected), so a stale
  // or tampered cookie value is a UX nuisance at worst, never a trust
  // boundary. 1-year ceiling; `samesite=lax` matches the refresh-token/CSRF
  // cookie pair's own setting (session-cookies.util.ts).
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export interface TrainerContextState {
  activeTrainerId: string | null;
  setActiveTrainerId: (trainerId: string | null) => void;
}

// fe §6.3: "{ activeTrainerId: string | null }, backed by a non-httpOnly
// cookie for SSR-readability." Selecting a context is documented (fe §5.2
// point 2/3) as needing to invalidate every trainer-scoped TanStack Query
// key — that invalidation is deliberately NOT done inside this store: a
// plain Zustand store module has no access to the QueryClient instance
// (created by QueryProvider, Task 10.7, and only reachable via
// `useQueryClient()` inside the React tree). The call site that changes the
// active context (ContextSwitcher, Phase 14) is responsible for pairing
// `setActiveTrainerId` with `queryClient.invalidateQueries(...)`.
export const useTrainerContextStore = create<TrainerContextState>((set) => ({
  activeTrainerId: readCookie(ACTIVE_TRAINER_COOKIE),
  setActiveTrainerId: (trainerId) => {
    writeCookie(ACTIVE_TRAINER_COOKIE, trainerId);
    set({ activeTrainerId: trainerId });
  },
}));
