import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { BootSequence } from '../src/components/BootSequence';
import { ErrorBoundary } from '../src/components/shared/ErrorBoundary';
import { ToastContainer } from '../src/components/shared/ToastContainer';
import { AuthenticatedShell } from '../src/components/shell/AuthenticatedShell';
import { BackgroundGradient } from '../src/components/shell/BackgroundGradient';
import { PageMetaController } from '../src/hooks/usePageMeta';
import { AppProviders } from '../src/providers/AppProviders';
import '@fontsource-variable/figtree';
import '../src/styles/globals.css';

// Runs before first paint: applies the saved theme so a light-theme user never
// sees a dark flash. Default (no saved choice) is dark.
const THEME_INIT_SCRIPT = "try{var t=localStorage.getItem('pp.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

// No static `title` here on purpose: Next re-applies a metadata title after
// every client navigation and would clobber the per-page tab title that
// PageMetaController (src/hooks/usePageMeta.tsx) sets from lib/pageMeta.ts.
export const metadata: Metadata = {
  description: 'Training, coaching and family scheduling for sports organisations.',
};

// specs/frontend-design-spec.md (2026-09-24 note, next-build-turbopack fix)
// — this stays a Server Component deliberately: the standard App Router
// pattern is "root layout is a Server Component, interactivity lives in a
// leaf/child Client Component," and having a Client Component wrap
// <html>/<body> was the trigger for a currently-open upstream Next.js 16.x
// static-generation bug (see BootSequence.tsx's note). The boot-sequence
// (refresh-on-mount, Task 10.8) and the ImpersonationBanner slot now live in
// <BootSequence>, which still mounts inside AppProviders exactly as before
// — this is a pure relocation, not a behavior change.
//
// fe §9.4/Task 18.3 — `ErrorBoundary` and `ToastContainer` join the root
// composition here. `ToastContainer` sits OUTSIDE `ErrorBoundary`
// deliberately: a toast already in flight should keep working even if
// something under the boundary crashes and gets replaced by the generic
// fallback. `ErrorBoundary` wraps `BootSequence` (not the other way around)
// so a crash during the boot sequence itself is also caught, not just
// crashes in already-authenticated route content.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppProviders>
          <BackgroundGradient />
          <PageMetaController />
          <ToastContainer />
          <ErrorBoundary>
            <BootSequence>
              <AuthenticatedShell>{children}</AuthenticatedShell>
            </BootSequence>
          </ErrorBoundary>
        </AppProviders>
      </body>
    </html>
  );
}
