'use client';

import type { ReactNode } from 'react';

import { QueryProvider } from './QueryProvider';

// Composition root for every client-side provider the app needs (fe §3's
// root layout note: "mounts ... the TanStack Query / Zustand providers").
// Zustand stores need no React-context provider of their own — that's the
// point of Zustand over Context (fe §6.1) — so this wraps only
// QueryProvider today. Later layout-level providers join here rather than
// being added ad hoc to app/layout.tsx.
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
