'use client';

import type { ReactNode } from 'react';

import { BootRevealItem, BootRevealShell } from '../shared/BootReveal';
import { PortalLogo } from '../shared/PortalLogo';
import { Wordmark } from '../shared/Wordmark';
import { ThemeToggle } from '../shell/ThemeToggle';

export interface AuthCardLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

// Shared frame for the signed-out screens (sign in, forgot/reset password,
// account setup, email verification): brand mark on top, one solid card with
// the heading and the form, and the theme switch pinned bottom-right.
export function AuthCardLayout({ title, subtitle, children }: AuthCardLayoutProps) {
  return (
    <main className="relative flex min-h-screen w-full items-center justify-center p-lg">
      <BootRevealShell className="w-full max-w-[26rem]">
        <BootRevealItem>
          <div className="mb-lg flex items-center justify-center gap-sm">
            <PortalLogo className="h-11 w-11 object-contain" />
            <Wordmark />
          </div>
        </BootRevealItem>
        <BootRevealItem>
          <div className="rounded-[20px] border border-border-soft bg-surface-1 p-xl shadow-card-strong">
            <h1 className="font-display text-section-title text-ink">{title}</h1>
            {subtitle ? <p className="mb-lg mt-xxs text-body text-ink-muted">{subtitle}</p> : <div className="mb-lg" />}
            {children}
          </div>
        </BootRevealItem>
      </BootRevealShell>

      <div className="fixed bottom-lg right-lg z-20">
        <ThemeToggle />
      </div>
    </main>
  );
}
