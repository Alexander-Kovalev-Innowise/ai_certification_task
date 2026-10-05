import { getIconPaths, type NavIconName } from '../components/shell/NavIcon';

export interface PageMeta {
  title: string;
  icon: NavIconName;
}

export const APP_NAME = 'PracticePerfect';

// The single place page titles and tab icons are edited. Patterns are
// matched against the pathname in order; `[param]` segments match any one
// path segment. A page can still override its entry at runtime with
// `usePageMeta()` (e.g. to put a user's name in the title).
const ROUTE_META: ReadonlyArray<readonly [pattern: string, meta: PageMeta]> = [
  ['/login', { title: 'Sign in', icon: 'log-in' }],
  ['/register', { title: 'Complete setup', icon: 'user-check' }],
  ['/forgot-password', { title: 'Forgot password', icon: 'key' }],
  ['/reset-password', { title: 'Reset password', icon: 'key' }],
  ['/verify-email', { title: 'Verify email', icon: 'mail' }],
  ['/change-password', { title: 'Change password', icon: 'key' }],
  ['/join/[code]', { title: 'Join a trainer', icon: 'link' }],
  ['/dashboard', { title: 'Dashboard', icon: 'home' }],
  ['/users/[id]', { title: 'Edit user', icon: 'user' }],
  ['/users', { title: 'Users', icon: 'users' }],
  ['/impersonation-history', { title: 'Impersonation history', icon: 'clock' }],
  ['/coaches', { title: 'Coaches', icon: 'user-check' }],
  ['/players', { title: 'Players', icon: 'users' }],
  ['/share-links', { title: 'Share links', icon: 'link' }],
  ['/branding', { title: 'Branding', icon: 'palette' }],
  ['/my-times', { title: 'My times', icon: 'clock' }],
  ['/profile', { title: 'Coach profile', icon: 'user' }],
  ['/profiles/[id]/availability', { title: 'Availability', icon: 'calendar' }],
  ['/profiles/[id]', { title: 'Player profile', icon: 'user' }],
  ['/profiles', { title: 'Profiles', icon: 'users' }],
  ['/approvals', { title: 'Approvals', icon: 'check-circle' }],
  ['/account/profile', { title: 'My account', icon: 'user' }],
];

const FALLBACK_META: PageMeta = { title: APP_NAME, icon: 'home' };

function matches(pattern: string, pathname: string): boolean {
  const want = pattern.split('/');
  const have = pathname.split('/');
  return want.length === have.length && want.every((part, i) => (part.startsWith('[') ? Boolean(have[i]) : part === have[i]));
}

export function resolvePageMeta(pathname: string): PageMeta {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ROUTE_META.find(([pattern]) => matches(pattern, clean))?.[1] ?? FALLBACK_META;
}

export function formatDocumentTitle(title: string): string {
  return title === APP_NAME ? APP_NAME : `${title} | ${APP_NAME}`;
}

// A 32x32 tab icon: the portal's near-black tile with the page's line icon
// in the platform accent green. Inline data URI, so no extra requests.
export function faviconHref(icon: NavIconName): string {
  const paths = getIconPaths(icon)
    .map((d) => `<path d="${d}"/>`)
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0D0D0D"/>` +
    `<g transform="translate(6 6) scale(0.833)" fill="none" stroke="#00B300" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
