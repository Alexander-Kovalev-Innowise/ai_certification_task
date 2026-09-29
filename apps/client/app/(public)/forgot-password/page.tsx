import { ForgotPasswordForm } from '../../../src/components/auth/ForgotPasswordForm';

// fe §4.1 "/forgot-password" — @Public() route, no shell chrome.
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-surface-0 p-lg">
      <div className="w-full max-w-[28rem]">
        <h1 className="mb-lg font-display text-hero-title text-text-primary">Reset your password</h1>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
