export interface CoachAcceptFormProps {
  trainerDisplayName: string;
  /** No body needed (fe §4.2) — already authenticated, target-email match is asserted server-side. */
  onSubmit: () => void;
  isSubmitting?: boolean;
  submitError?: string | null;
}

// fe §4.2 — "access token present, role=COACH, type=COACH_UNIQUE → render
// <CoachAcceptForm> (no password field — already authenticated)". A simple
// confirmation, not a form with inputs: everything COACH_ACCEPT needs for
// an already-authenticated coach is already known server-side.
export function CoachAcceptForm({ trainerDisplayName, onSubmit, isSubmitting = false, submitError = null }: CoachAcceptFormProps) {
  return (
    <div className="flex w-full flex-col gap-md text-center">
      <p className="text-body text-[var(--text-primary)]">Accept this invitation to coach for {trainerDisplayName}?</p>

      {submitError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          {submitError}
        </p>
      )}

      <button
        type="button"
        onClick={() => onSubmit()}
        disabled={isSubmitting}
        className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {isSubmitting ? 'Joining…' : 'Accept invitation'}
      </button>
    </div>
  );
}
