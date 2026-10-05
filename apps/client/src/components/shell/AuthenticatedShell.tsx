'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useBootstrap } from '../../hooks/useBootstrap';
import { BrandingProvider, type BrandingInput } from '../../lib/branding/BrandingProvider';
import { useAuthStore } from '../../stores/useAuthStore';
import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { AccountType, Role } from '../../types/auth';
import { ContextSwitcher, resolveCurrentContext, type ContextEntry } from '../player/ContextSwitcher';

import { AppShell, type ShellLink } from './AppShell';
import { NAV_BY_ROLE, PLAYER_NAV_LABEL, playerLinks } from './roleNav';

// Routes that never get the in-app chrome: the landing redirect, the public
// auth flows, the forced password change screen and the public join links.
const NON_SHELL_EXACT = new Set(['/', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/change-password']);
const NON_SHELL_PREFIXES = ['/join/'];

export function isShellRoute(pathname: string | null): pathname is string {
  if (!pathname) return false;
  if (NON_SHELL_EXACT.has(pathname)) return false;
  if (pathname === '/join' || NON_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return true;
}

interface PlayerParentBootstrapShape {
  accountType: AccountType;
  contexts: ContextEntry[];
  activeContext: ContextEntry | null;
}

function hasPlayerParentShape(data: unknown): data is PlayerParentBootstrapShape {
  return (
    typeof data === 'object' &&
    data !== null &&
    'accountType' in data &&
    'contexts' in data &&
    Array.isArray((data as { contexts?: unknown }).contexts)
  );
}

function hasTrainerBranding(data: unknown): data is { branding: BrandingInput } {
  return typeof data === 'object' && data !== null && 'branding' in data;
}

function hasCoachBranding(data: unknown): data is { employingTrainer: BrandingInput } {
  return typeof data === 'object' && data !== null && 'employingTrainer' in data;
}

interface ShellConfig {
  navLabel: string;
  links: readonly ShellLink[];
  headerStart?: ReactNode;
  branding: BrandingInput | null;
}

function resolveShellConfig(role: Role, data: unknown, activeTrainerId: string | null, activeProfileId: string | null): ShellConfig {
  switch (role) {
    case 'TRAINER':
      return { ...NAV_BY_ROLE.TRAINER, branding: hasTrainerBranding(data) ? data.branding : null };
    case 'COACH':
      return { ...NAV_BY_ROLE.COACH, branding: hasCoachBranding(data) ? data.employingTrainer : null };
    case 'SUPER_ADMIN':
      return { ...NAV_BY_ROLE.SUPER_ADMIN, branding: null };
    case 'PLAYER_PARENT': {
      if (!hasPlayerParentShape(data)) {
        return { navLabel: PLAYER_NAV_LABEL, links: playerLinks(false), branding: null };
      }
      const { accountType, contexts, activeContext } = data;
      const current = resolveCurrentContext(contexts, activeContext, activeTrainerId, activeProfileId);
      return {
        navLabel: PLAYER_NAV_LABEL,
        links: playerLinks(accountType === 'ADULT', accountType === 'CHILD'),
        headerStart: <ContextSwitcher accountType={accountType} contexts={contexts} activeContext={activeContext} />,
        branding: current ? { logoUrl: current.logoUrl, primaryColorHex: current.primaryColorHex } : null,
      };
    }
    default:
      return { navLabel: 'Navigation', links: [], branding: null };
  }
}

// One fixed tree shape, always: BrandingProvider > AppShell > children. While
// bootstrap loads only the `branding` prop changes (null -> real), so nothing
// above `children` ever remounts.
function ShellFrame({ role, children }: { role: Role; children: ReactNode }) {
  const { data } = useBootstrap();
  const activeTrainerId = useTrainerContextStore((state) => state.activeTrainerId);
  const activeProfileId = useTrainerContextStore((state) => state.activeProfileId);
  const { navLabel, links, headerStart, branding } = resolveShellConfig(role, data, activeTrainerId, activeProfileId);

  // Bootstrap is the persistent source of the profile photo for the user
  // pill (the login/refresh session payload has none): mirror it into the
  // auth store whenever it differs.
  const bootstrapPhotoUrl = data?.user?.photoUrl;
  useEffect(() => {
    if (bootstrapPhotoUrl === undefined) {
      return;
    }
    useAuthStore.setState((state) =>
      state.user && (state.user.photoUrl ?? null) !== bootstrapPhotoUrl ? { user: { ...state.user, photoUrl: bootstrapPhotoUrl } } : state,
    );
  }, [bootstrapPhotoUrl]);

  return (
    <BrandingProvider branding={branding}>
      <AppShell navLabel={navLabel} links={links} headerStart={headerStart}>
        {children}
      </AppShell>
    </BrandingProvider>
  );
}

// Mounted ONCE in app/layout.tsx so the sidebar, its collapse state, the
// sliding active-row highlight and the header persist across every in-app
// navigation instead of being torn down and rebuilt by each role layout.
export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const pathname = usePathname();

  if (!user || !isShellRoute(pathname)) {
    return <>{children}</>;
  }

  return <ShellFrame role={user.role}>{children}</ShellFrame>;
}
