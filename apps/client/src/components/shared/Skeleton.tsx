import type { HTMLAttributes } from 'react';

// fe §9.5 — base skeleton primitives. Every route builds its OWN skeleton
// shape (matched to that route's actual grid/table/card layout) out of
// these three pieces, rather than everyone sharing one generic shimmer
// block — "the visual interest budget in this app goes to the context-
// switch and impersonation-entry moments, not to loading chrome users see
// dozens of times a day." `motion-reduce:animate-none` honors
// prefers-reduced-motion (accessibility checklist).
function pulseClassName(extra: string): string {
  return `animate-pulse rounded-sm bg-[var(--surface-2)] motion-reduce:animate-none ${extra}`;
}

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** A single line of placeholder text (a table cell, a label, a line of body copy). */
export function SkeletonRow({ className = '', ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={pulseClassName(`h-4 w-full ${className}`)} {...props} />;
}

/** A card-shaped placeholder (title line + body line), matching the `card` token's radius/shadow. */
export function SkeletonCard({ className = '', ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-md border border-[var(--border-soft)]/20 bg-[var(--surface-1)] p-md shadow-card-soft ${className}`}
      {...props}
    >
      <div className={pulseClassName('mb-sm h-4 w-2/3')} />
      <div className={pulseClassName('h-3 w-full')} />
    </div>
  );
}

/** A single square-ish cell placeholder (AvailabilityGrid's per-slot cells, fe §5.4). */
export function SkeletonGridCell({ className = '', ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={pulseClassName(`aspect-square w-full ${className}`)} {...props} />;
}
