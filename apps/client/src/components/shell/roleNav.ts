import type { Role } from '../../types/auth';

import type { ShellLink } from './AppShell';

const DASHBOARD: ShellLink = { href: '/dashboard', label: 'Dashboard', icon: 'home' };

const TRAINER_LINKS: readonly ShellLink[] = [
  DASHBOARD,
  { href: '/coaches', label: 'Coaches', icon: 'user-check' },
  { href: '/players', label: 'Players', icon: 'users' },
  { href: '/share-links', label: 'Share Links', icon: 'link' },
  { href: '/branding', label: 'Branding', icon: 'palette' },
];

const COACH_LINKS: readonly ShellLink[] = [
  DASHBOARD,
  { href: '/my-times', label: 'My Times', icon: 'clock' },
  { href: '/profile', label: 'Profile', icon: 'user' },
];

const SUPER_ADMIN_LINKS: readonly ShellLink[] = [
  DASHBOARD,
  { href: '/users', label: 'Users', icon: 'users' },
  { href: '/impersonation-history', label: 'Impersonation History', icon: 'clock' },
];

// Approvals is adult-parent-only (fe §4.6/§9.4) — hidden, not disabled, for a
// CHILD session. "My requests" is the CHILD-only mirror: the child's own
// purchase requests (and the New request stand-in for checkout).
export function playerLinks(showApprovals: boolean, isChild = false): readonly ShellLink[] {
  return [
    DASHBOARD,
    { href: '/profiles', label: 'Profiles', icon: 'users' },
    ...(showApprovals ? [{ href: '/approvals', label: 'Approvals', icon: 'check-circle' } as const] : []),
    ...(isChild ? [{ href: '/requests', label: 'My requests', icon: 'check-circle' } as const] : []),
  ];
}

export const NAV_BY_ROLE: Record<Exclude<Role, 'PLAYER_PARENT'>, { navLabel: string; links: readonly ShellLink[] }> = {
  TRAINER: { navLabel: 'Trainer navigation', links: TRAINER_LINKS },
  COACH: { navLabel: 'Coach navigation', links: COACH_LINKS },
  SUPER_ADMIN: { navLabel: 'Super Admin navigation', links: SUPER_ADMIN_LINKS },
};

export const PLAYER_NAV_LABEL = 'Player/Parent navigation';
