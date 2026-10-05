'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react';

// Thin-outline (feather-style) 18px inline SVG icons for table row actions.
// Every ActionIcon control carries a human `aria-label` + matching `title`
// (the same words the old text buttons used), so the icon-only affordance
// stays discoverable by users, screen readers and tests alike.
export type ActionIconName = 'edit' | 'trash' | 'refresh' | 'toggle' | 'user-x' | 'calendar';

const ICON_SIZE = 18;

const GLYPHS: Record<ActionIconName, ReactElement> = {
  edit: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  toggle: (
    <>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </>
  ),
  'user-x': (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="18" y1="8" x2="23" y2="13" />
      <line x1="23" y1="8" x2="18" y2="13" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
};

export function ActionGlyph({ name }: { name: ActionIconName }) {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

const BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
const DANGER_CLASS = 'hover:text-danger';

interface ActionIconCommonProps {
  icon: ActionIconName;
  /** Human-readable name; becomes both `aria-label` and `title`. */
  label: string;
  tone?: 'default' | 'danger';
  className?: string;
}

function classes({ tone = 'default', className = '' }: Pick<ActionIconCommonProps, 'tone' | 'className'>) {
  return `${BASE_CLASS} ${tone === 'danger' ? DANGER_CLASS : ''} ${className}`.trim();
}

export interface ActionIconButtonProps
  extends ActionIconCommonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label' | 'title'> {}

export const ActionIconButton = forwardRef<HTMLButtonElement, ActionIconButtonProps>(function ActionIconButton(
  { icon, label, tone, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={classes({ tone, className })} {...rest}>
      <ActionGlyph name={icon} />
    </button>
  );
});

export interface ActionIconLinkProps extends ActionIconCommonProps {
  href: string;
}

// Internal navigation always goes through next/link, never a raw <a href>.
export function ActionIconLink({ icon, label, href, tone, className }: ActionIconLinkProps) {
  return (
    <Link href={href} aria-label={label} title={label} className={classes({ tone, className })}>
      <ActionGlyph name={icon} />
    </Link>
  );
}
