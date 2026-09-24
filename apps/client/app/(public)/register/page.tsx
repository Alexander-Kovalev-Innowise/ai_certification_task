import { Suspense } from 'react';

import { TrainerSetupForm } from '../../../src/components/auth/TrainerSetupForm';

// fe §4.1 "/register?token=" — @Public(), trainer-setup-link completion
// ONLY (api §8.4, resolved: no general self-registration flow exists).
export default function RegisterPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <div className="w-full max-w-md">
        <h1 className="mb-lg font-display text-hero-title text-[var(--text-primary)]">Complete your account</h1>
        <Suspense fallback={null}>
          <TrainerSetupForm />
        </Suspense>
      </div>
    </main>
  );
}
