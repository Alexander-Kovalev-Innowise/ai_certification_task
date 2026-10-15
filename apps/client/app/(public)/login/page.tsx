import { AuthCardLayout } from '../../../src/components/auth/AuthCardLayout';
import { LoginForm } from '../../../src/components/auth/LoginForm';

// fe §4.1 "/login" — @Public() route, no shell chrome (route group `(public)`
// per fe §3's route map). LoginForm owns the POST /auth/login call and the
// mustChangePassword/ACCOUNT_INACTIVE branching (Task 11.1); the one-time
// staggered boot reveal (fe §1.3) lives in AuthCardLayout. `?next=` (e.g. the
// join page's "Already have an account? Sign in") is passed through and
// validated by LoginForm before it is ever used as a redirect target.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = Array.isArray(next) ? next[0] : next;

  return (
    <AuthCardLayout title="Welcome back" subtitle="Sign in to your PracticePerfect portal.">
      <LoginForm next={nextPath ?? null} />
    </AuthCardLayout>
  );
}
