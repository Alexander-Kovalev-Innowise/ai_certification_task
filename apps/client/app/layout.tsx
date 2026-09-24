import type { ReactNode } from 'react';

import { BootSequence } from '../src/components/BootSequence';
import { clashDisplay, generalSans } from '../src/lib/fonts';
import { AppProviders } from '../src/providers/AppProviders';
import '../src/styles/globals.css';

// specs/frontend-design-spec.md (2026-09-24 note, next-build-turbopack fix)
// — this stays a Server Component deliberately: the standard App Router
// pattern is "root layout is a Server Component, interactivity lives in a
// leaf/child Client Component," and having a Client Component wrap
// <html>/<body> was the trigger for a currently-open upstream Next.js 16.x
// static-generation bug (see BootSequence.tsx's note). The boot-sequence
// (refresh-on-mount, Task 10.8) and the ImpersonationBanner slot now live in
// <BootSequence>, which still mounts inside AppProviders exactly as before
// — this is a pure relocation, not a behavior change.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${clashDisplay.variable} ${generalSans.variable}`}>
      <body>
        <AppProviders>
          <BootSequence>{children}</BootSequence>
        </AppProviders>
      </body>
    </html>
  );
}
