'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';

const NAV_LINKS = [
  { href: '/users', label: 'Users' },
  { href: '/impersonation-history', label: 'Impersonation History' },
] as const;

// fe §3/§4.3 — `(super-admin)/layout.tsx`: RoleGuard(SUPER_ADMIN) + SA nav
// shell (Users, Impersonation History links). Wraps every Super Admin route
// this phase adds (`/users`, `/users/[id]`) — NOT `/dashboard`, which is the
// single unified route living outside every `(role)` group (fe §3's
// 2026-09-24 correction, see apps/client/app/dashboard/page.tsx).
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="SUPER_ADMIN">
      <div className="flex min-h-screen flex-col">
        <nav
          aria-label="Super Admin navigation"
          className="flex items-center gap-lg border-b border-[var(--border-soft)] bg-[var(--surface-1)] px-lg py-sm"
        >
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-body text-[var(--text-primary)] hover:text-[var(--brand-primary)]">
              {link.label}
            </a>
          ))}
        </nav>
        <main className="flex-1">{children}</main>
      </div>
    </RoleGuard>
  );
}
