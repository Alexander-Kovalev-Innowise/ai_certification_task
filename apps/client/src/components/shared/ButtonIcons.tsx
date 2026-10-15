import type { ReactNode } from 'react';

// Small feather-style 18px inline SVG icons for text buttons (icon sits to
// the LEFT of the label). Decorative: the button text carries the name.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="flex-none"
    >
      {children}
    </svg>
  );
}

/** Ban-circle: deactivate. */
export function DeactivateIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </Icon>
  );
}

/** Rotate / play-circle: reactivate. */
export function ReactivateIcon() {
  return (
    <Icon>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </Icon>
  );
}

/** Eye: impersonate. */
export function ImpersonateIcon() {
  return (
    <Icon>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** Trash: delete. */
export function TrashIcon() {
  return (
    <Icon>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Icon>
  );
}

export function MailIcon() {
  return (
    <Icon>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </Icon>
  );
}
