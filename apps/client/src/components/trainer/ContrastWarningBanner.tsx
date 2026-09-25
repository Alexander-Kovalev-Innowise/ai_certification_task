'use client';

// fe §8 / api §4.1 (OQ-7) — "the service computes ... a WCAG-derived
// accessible palette ... and returns a non-blocking `contrastWarning?:
// string` ... if the chosen color fails AA against white/black text — it
// never rejects the PATCH outright." By the time this banner can render,
// `PATCH /trainers/:id/branding` has already returned 200 and the branding
// was already saved — this is purely advisory, dismissible, and never a
// pre-save gate (fe §8, resolved OQ-7/G-11). Task 17.2.
export interface ContrastWarningBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ContrastWarningBanner({ message, onDismiss }: ContrastWarningBannerProps) {
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-sm rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-sm text-body text-[var(--warning)]"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss contrast warning"
        className="text-caption font-semibold text-[var(--warning)]"
      >
        Dismiss
      </button>
    </div>
  );
}
