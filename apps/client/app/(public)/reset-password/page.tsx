import { Suspense } from 'react';

import { ResetPasswordForm } from '../../../src/components/auth/ResetPasswordForm';

// fe §4.1 "/reset-password?token=" — @Public() route. `ResetPasswordForm`
// reads the token via next/navigation's useSearchParams(), which Next.js
// requires to be wrapped in a Suspense boundary for a route that would
// otherwise attempt static prerendering.
export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <div className="w-full max-w-md">
        <h1 className="mb-lg font-display text-hero-title text-[var(--text-primary)]">Set a new password</h1>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
