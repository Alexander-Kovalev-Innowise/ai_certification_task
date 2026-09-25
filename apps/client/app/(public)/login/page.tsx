import { LoginForm } from '../../../src/components/auth/LoginForm';
import { BootRevealItem, BootRevealShell } from '../../../src/components/shared/BootReveal';

// fe §4.1 "/login" — @Public() route, no shell chrome (route group `(public)`
// per fe §3's route map). Component itself owns the POST /auth/login call
// and the mustChangePassword/ACCOUNT_INACTIVE branching (Task 11.1).
//
// fe §1.3/Task 18.5 — one of the only two routes in the app with the
// one-time staggered boot reveal (logo -> headline -> form, 60ms stagger,
// 220ms ease-out); `BootRevealShell`/`BootRevealItem` are the shared client
// boundary that animation needs — this file itself stays a Server
// Component, same "root layout stays a Server Component, interactivity
// lives in a child" pattern BootSequence.tsx already established.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <BootRevealShell className="w-full max-w-md">
        <BootRevealItem>
          {/* eslint-disable-next-line @next/next/no-img-element -- static platform mark, pre-branding (no active tenant context on /login) */}
          <img src="/default_logo.svg" alt="PracticePerfect" className="mb-md h-12 w-12" />
        </BootRevealItem>
        <BootRevealItem>
          <h1 className="mb-lg font-display text-hero-title text-[var(--text-primary)]">Sign in</h1>
        </BootRevealItem>
        <BootRevealItem>
          <LoginForm />
        </BootRevealItem>
      </BootRevealShell>
    </main>
  );
}
