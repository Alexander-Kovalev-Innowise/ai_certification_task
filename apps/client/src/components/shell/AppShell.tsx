'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { logout } from '../../lib/api/apiClient';
import { useOptionalBranding } from '../../lib/branding/BrandingProvider';
import { thumbnailUrlFor } from '../../lib/upload/imageUpload';
import { useAuthStore } from '../../stores/useAuthStore';
import { DEFAULT_LOGO_URL, PortalLogo } from '../shared/PortalLogo';
import { Wordmark } from '../shared/Wordmark';

import { NavIcon, type NavIconName } from './NavIcon';
import { ThemeToggle } from './ThemeToggle';
import { useSidebarCollapsed } from './useSidebarCollapsed';

export interface ShellLink {
  href: string;
  label: string;
  icon: NavIconName;
}

export interface AppShellProps {
  navLabel: string;
  links: readonly ShellLink[];
  // Left side of the top bar — ContextSwitcher for player/parent.
  headerStart?: ReactNode;
  children: ReactNode;
}

const ACCOUNT_HREF = '/account/profile';
// fe §3/§4.7 — persistent, never conditionally hidden; sits last in the sidebar.
const ACCOUNT_LINK: ShellLink = { href: ACCOUNT_HREF, label: 'Account', icon: 'user' };

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function UserMenu() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isImpersonating = useAuthStore((state) => state.isImpersonating);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  async function handleSignOut() {
    setOpen(false);
    await logout();
    router.replace('/login');
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
        className="flex h-[38px] items-center gap-xs rounded-pill bg-surface-green py-0 pl-xxs pr-sm text-caption font-semibold text-ink hover:brightness-125"
      >
        <span className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-pill bg-[#0D0D0D] text-eyebrow font-semibold text-[#E6FFE6]">
          {user.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded thumbnail served by the API
            <img src={thumbnailUrlFor(user.photoUrl)} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(user.firstName, user.lastName)
          )}
        </span>
        <span className="max-w-[10rem] truncate">
          {user.firstName} {user.lastName}
        </span>
        <NavIcon name="chevron-down" size={16} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-xs flex min-w-[11rem] flex-col gap-xxs rounded-md border border-border-soft bg-surface-1 p-xs shadow-card-strong">
          <Link
            role="menuitem"
            href={ACCOUNT_HREF}
            onClick={() => setOpen(false)}
            className="flex items-center gap-sm rounded-sm px-sm py-xs text-body text-ink hover:bg-surface-2"
          >
            <NavIcon name="user" size={18} />
            Account
          </Link>
          {!isImpersonating && (
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="flex items-center gap-sm rounded-sm px-sm py-xs text-left text-body text-ink hover:bg-surface-2"
            >
              <NavIcon name="log-out" size={18} />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Task/designs/event_builder.svg — persistent left sidebar on its own solid
// panel (logo tile + animated wordmark + icon nav, active row on #173F17)
// with the theme toggle and user pill top-right and the slowly drifting green
// spotlight behind it all. The sidebar collapses to an icon rail via a round
// handle sitting on its right edge level with the logo (width animates,
// wordmark/labels fade and slide, state persists); the active-row highlight
// glides between items via a shared layoutId. Below the md breakpoint the
// same <nav> becomes a horizontally scrolling strip above the content and the
// handle + wordmark are hidden.
export function AppShell({ navLabel, links, headerStart, children }: AppShellProps) {
  const pathname = usePathname();
  const branding = useOptionalBranding();
  const logoUrl = branding?.logoUrl ?? DEFAULT_LOGO_URL;
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const reduceMotion = useReducedMotion();

  return (
    <div className="app-glow flex min-h-screen flex-col md:flex-row">
      <aside
        data-collapsed={collapsed}
        className={`relative z-20 flex shrink-0 items-center gap-md border-b border-border-soft bg-surface-sidebar p-md motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-in-out md:sticky md:top-0 md:h-screen md:flex-col md:items-stretch md:gap-lg md:border-b-0 md:border-r ${
          collapsed ? 'md:w-[5rem]' : 'md:w-[15rem]'
        }`}
      >
        <div className="flex h-[47px] shrink-0 items-center gap-sm">
          <div className="flex h-[47px] w-[47px] shrink-0 items-center justify-center rounded-[14px] border border-border-soft bg-surface-0">
            <PortalLogo src={logoUrl} alt="Portal logo" className="h-8 w-8 object-contain" />
          </div>
          <span
            aria-hidden="true"
            className={`hidden overflow-hidden whitespace-nowrap motion-safe:transition-[max-width,opacity,transform] motion-safe:duration-300 md:block ${
              collapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-[9rem] translate-x-0 opacity-100 motion-safe:delay-100'
            }`}
          >
            <Wordmark />
          </span>
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-[13px] top-[26px] z-30 hidden h-[26px] w-[26px] items-center justify-center rounded-pill border border-ink/60 bg-surface-sidebar text-ink shadow-card-soft transition-colors hover:border-brand-primary hover:text-brand-primary md:flex"
        >
          <span className={`flex motion-safe:transition-transform motion-safe:duration-300 ${collapsed ? '-scale-x-100' : ''}`}>
            <NavIcon name="panel-left-close" size={14} />
          </span>
        </button>

        <nav aria-label={navLabel} className="flex min-w-0 flex-1 gap-xxs overflow-x-auto md:flex-col md:overflow-visible">
          {[...links, ACCOUNT_LINK].map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? link.label : undefined}
                title={collapsed ? link.label : undefined}
                className={`group relative flex h-[46px] shrink-0 items-center gap-sm rounded-sm pl-[14px] pr-md text-body whitespace-nowrap transition-colors duration-200 ${
                  link === ACCOUNT_LINK ? 'md:mt-auto' : ''
                } ${active ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'}`}
              >
                {active ? (
                  <motion.span
                    layoutId="sidebar-active"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-sm bg-surface-green"
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-sm bg-ink/5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  />
                )}
                <span className="relative z-10 flex shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-hover:scale-110">
                  <NavIcon name={link.icon} />
                </span>
                <span
                  className={`relative z-10 overflow-hidden motion-safe:transition-[max-width,opacity] motion-safe:duration-300 ${
                    collapsed ? 'md:max-w-0 md:opacity-0' : 'md:max-w-[12rem] md:opacity-100'
                  }`}
                >
                  {link.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-md px-lg pt-md md:pt-lg">
          <div className="min-w-0">{headerStart}</div>
          <div className="flex items-center gap-sm">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
