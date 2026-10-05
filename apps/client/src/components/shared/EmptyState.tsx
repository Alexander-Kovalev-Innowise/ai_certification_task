import type { ReactNode } from 'react';

export type EmptyStateIcon = 'search' | 'inbox';

export interface EmptyStateProps {
  /** Short headline. Rendered in an element with `role="status"` so it is announced and easy to query. */
  title: string;
  description?: ReactNode;
  icon?: EmptyStateIcon;
  /** Optional call-to-action slot (e.g. a "Clear filters" button). */
  action?: ReactNode;
  className?: string;
}

const GLYPHS: Record<EmptyStateIcon, ReactNode> = {
  // Magnifier with a slash through it: "nothing matched".
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M8 14l6-6" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
};

const GLOW = '0 0 0 6px rgba(var(--brand-primary-rgb), 0.08), 0 8px 28px rgba(var(--brand-primary-rgb), 0.22)';

// Centered placeholder for lists with nothing to show: a large rounded icon
// tile (brand-green line icon on surface-2 with a soft glow ring), a title, a
// muted description and an optional action slot.
export function EmptyState({ title, description, icon = 'search', action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex w-full max-w-[34rem] flex-col items-center px-lg py-xxl text-center ${className}`.trim()}>
      <div
        className="flex h-20 w-20 items-center justify-center rounded-lg border border-border-soft bg-surface-2 text-brand-primary"
        style={{ boxShadow: GLOW }}
      >
        <svg
          width={36}
          height={36}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          data-testid="empty-state-icon"
        >
          {GLYPHS[icon]}
        </svg>
      </div>
      <p role="status" className="mt-lg text-block-title font-semibold text-ink">
        {title}
      </p>
      {description ? <p className="mt-xs max-w-[28rem] text-body-lg text-text-secondary">{description}</p> : null}
      {action ? <div className="mt-md">{action}</div> : null}
    </div>
  );
}
