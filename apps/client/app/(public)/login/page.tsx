import { LoginForm } from '../../../src/components/auth/LoginForm';

// fe §4.1 "/login" — @Public() route, no shell chrome (route group `(public)`
// per fe §3's route map). Component itself owns the POST /auth/login call
// and the mustChangePassword/ACCOUNT_INACTIVE branching (Task 11.1).
export default function LoginPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <div className="w-full max-w-md">
        <h1 className="mb-lg font-display text-hero-title text-[var(--text-primary)]">Sign in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
