'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { refreshSession } from '../lib/api/apiClient';

type BootState = 'pending' | 'resolved';

// Task 16.1 replaces this with the real ImpersonationBanner (fe §5.1) — a
// fixed top bar, sourced from the `act` claim on the decoded in-memory
// access token, that visually warns a Super Admin they're impersonating.
// Mounted here (inside BootSequence, itself mounted from the ROOT layout,
// not a role layout) deliberately: an impersonated session renders *inside*
// the target's own role layout, so the banner has to sit above that entire
// subtree. Left as a render-nothing slot here per Task 10.8's "Do" — the
// real component doesn't exist yet.
function ImpersonationBannerSlot() {
  return null;
}

// fe §6.1 boot step 2 — "a full-screen brand-neutral loading state (platform
// default accent, not a tenant color — no trainer is known yet)". This
// renders before BrandingProvider (Task 10.10) has anything to apply, so it
// only ever uses the static --surface-0/--brand-primary tokens already in
// globals.css, never a per-tenant color.
function BootLoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PracticePerfect"
      className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)]"
    >
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-primary)] border-t-transparent motion-reduce:animate-none"
      />
    </div>
  );
}

// specs/frontend-design-spec.md (2026-09-24 note, next-build-turbopack fix)
// — the boot-sequence logic (refresh-on-mount, Task 10.8) used to live
// directly in app/layout.tsx, which made the ROOT layout itself a Client
// Component wrapping <html>/<body>. That is a known trigger for a
// currently-open upstream Next.js 16.x Turbopack/webpack static-generation
// bug ("Cannot read properties of null (reading 'useContext'/'useState')"
// prerendering /_global-error or other routes — vercel/next.js#95741 and
// duplicates #86178/#84994/#85668, all still open). Moving the client
// boundary down to this leaf component — the standard App Router pattern
// of "root layout stays a Server Component, interactivity lives in a child"
// — resolved the build crash in this app and is the correct architecture
// regardless of the bug (arch note, not just a workaround).
export function BootSequence({ children }: { children: ReactNode }) {
  const [bootState, setBootState] = useState<BootState>('pending');

  useEffect(() => {
    let cancelled = false;

    // fe §6.1 — POST /auth/refresh (cookie-only, no body), called exactly
    // once on app mount. refreshSession() (Task 10.4) already implements
    // this exact call and populates useAuthStore on a 200; a 401 (or any
    // network failure) resolves `false` and useAuthStore simply stays null
    // — the app renders its anonymous tree, and RoleGuard (Task 10.9)
    // redirects to /login from any protected route. This component only
    // needs to know the attempt is *finished*, never which way it resolved
    // — that branch lives in RoleGuard/each route, not here.
    refreshSession()
      .catch(() => false)
      .finally(() => {
        if (!cancelled) {
          setBootState('resolved');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <ImpersonationBannerSlot />
      {bootState === 'pending' ? <BootLoadingScreen /> : children}
    </>
  );
}
