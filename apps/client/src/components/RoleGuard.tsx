'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuthStore } from '../stores/useAuthStore';
import type { Role } from '../types/auth';

// fe §3 (2026-09-24 correction) — `/dashboard` is a single unified route
// (`app/dashboard/page.tsx`, outside every `(role)` group), not four
// route-grouped `dashboard/page.tsx` leaves. It used to be documented as one
// leaf per role group ((super-admin)/dashboard, (trainer)/dashboard, etc.),
// but Next.js route groups (parenthesized segment names) never add a URL
// path segment, so all four would have resolved to the literal same
// `/dashboard` URL and Next.js rejects two page files resolving to the same
// path at build time. This constant's value is exactly right either way —
// "redirect to the caller's own dashboard" was always meant to mean this one
// shared URL.
const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/login';

export interface RoleGuardProps {
  /** The role(s) permitted to see `children`. */
  allow: Role | Role[];
  children: ReactNode;
}

/**
 * fe §3 — wraps each role route group's layout (`(super-admin)/layout.tsx`,
 * `(trainer)/layout.tsx`, etc). Redirects to /login when no authenticated
 * session exists; redirects to the caller's own dashboard when the session's
 * role isn't in `allow` (never a bare 403 — a signed-in user hitting the
 * wrong role's routes lands back on familiar ground, not an error screen).
 *
 * This is a UX guard only, same as every other client-side check in this
 * app (fe §0/§6.2's "all authorization is server-side" framing) — the API
 * re-validates role/capability on every request regardless of what this
 * component decides to render.
 */
export function RoleGuard({ allow, children }: RoleGuardProps) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const allowedRoles = Array.isArray(allow) ? allow : [allow];
  const isAllowed = !!user && allowedRoles.includes(user.role);
  // Stable string stand-in for `allowedRoles` in the effect's dependency
  // array — `allow` may be a fresh array literal on every render.
  const allowKey = allowedRoles.join(',');

  useEffect(() => {
    if (!user) {
      router.replace(LOGIN_PATH);
    } else if (!isAllowed) {
      router.replace(DASHBOARD_PATH);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isAllowed is derived from user/allowKey, which are already deps
  }, [user, router, allowKey]);

  if (!isAllowed) {
    return null;
  }

  return <>{children}</>;
}
