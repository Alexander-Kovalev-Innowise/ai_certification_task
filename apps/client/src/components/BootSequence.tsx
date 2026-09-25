'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { refreshSession } from '../lib/api/apiClient';

import { EmailVerifiedBanner } from './shared/EmailVerifiedBanner';
import { ImpersonationBanner } from './shared/ImpersonationBanner';

type BootState = 'pending' | 'resolved';

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
//
// fe §9.2/Task 18.2 — `EmailVerifiedBanner` mounts here too, for the exact
// same reason `ImpersonationBanner` does (root-boundary chrome above every
// role layout, needs the same leaf Client Component seam). The plan's Task
// 18.2 Files list names `app/layout.tsx` as the file to modify; this mounts
// one level down for consistency with that already-established precedent
// rather than reintroducing a Client Component at the <html>/<body>
// boundary — see the Phase 18 wrap-up report for the full deviation note.
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
      <ImpersonationBanner />
      {bootState === 'resolved' && <EmailVerifiedBanner />}
      {bootState === 'pending' ? <BootLoadingScreen /> : children}
    </>
  );
}
