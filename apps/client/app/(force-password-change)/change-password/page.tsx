'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ChangePasswordForm } from '../../../src/components/auth/ChangePasswordForm';
import { useAuthStore } from '../../../src/stores/useAuthStore';

const LOGIN_PATH = '/login';

// fe §3 route map — `(force-password-change)` is deliberately its own group,
// excluded from RoleGuard's normal allow-list/redirect table (Task 11.6): no
// role restriction here, since any authenticated role can land here with
// `mustChangePassword: true`. Still requires SOME session — an anonymous
// visitor hitting this URL directly has nothing to change, so it redirects
// to /login the same way RoleGuard does for a role-gated route.
export default function ChangePasswordPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      router.replace(LOGIN_PATH);
    }
  }, [user, router]);

  if (!user) {
    return null;
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <div className="w-full max-w-md">
        <h1 className="mb-lg font-display text-hero-title text-[var(--text-primary)]">
          {user.mustChangePassword ? 'Set a new password to continue' : 'Change your password'}
        </h1>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
