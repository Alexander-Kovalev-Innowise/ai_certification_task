import { Suspense } from 'react';

import { VerifyEmailStatus } from '../../../src/components/auth/VerifyEmailStatus';

// fe §4.1 "/verify-email?token=" — @Public() route, landing confirmation
// only (never a gate, architecture §6.5). Suspense wraps the
// useSearchParams()-reading client component per Next.js's requirement.
export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <div className="w-full max-w-md">
        <h1 className="mb-lg font-display text-hero-title text-[var(--text-primary)]">Email verification</h1>
        <Suspense fallback={null}>
          <VerifyEmailStatus />
        </Suspense>
      </div>
    </main>
  );
}
