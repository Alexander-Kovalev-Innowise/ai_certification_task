'use client';

import { useEffect, useState } from 'react';

import { useMe } from '../../hooks/useMe';
import { apiRequest } from '../../lib/api/apiClient';
import { readRetryAfterSeconds } from '../../lib/api/apiError';
import { useAuthStore } from '../../stores/useAuthStore';

/**
 * `ImpersonationBanner.tsx`'s `useNow` pattern (Task 16.1, itself following
 * `lib/api/authSession.ts`'s `Date.now()` convention), duplicated here
 * rather than extracted into a shared module — ImpersonationBanner's own
 * comment already documents this exact duplication as the established
 * approach (it copies `ApprovalCard.tsx`'s version verbatim).
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

type ResendState = 'idle' | 'sending' | 'sent' | 'error';

const TICK_MS = 1_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** The actual banner body — keyed by `user.id` in the exported wrapper below so switching sessions (logout → a different login) remounts it with fresh state, rather than an effect resetting `dismissed` on a dependency change (`react-hooks/set-state-in-effect`, the same key-remount preference the rest of this phase follows). */
function EmailVerifiedBannerContent() {
  const { data } = useMe();
  const [dismissed, setDismissed] = useState(false);
  const [resendState, setResendState] = useState<ResendState>('idle');
  const [retryAfterAt, setRetryAfterAt] = useState<number | null>(null);
  const now = useNow(TICK_MS);

  const remainingSeconds = retryAfterAt !== null ? Math.max(0, Math.ceil((retryAfterAt - now) / 1000)) : 0;
  const isCoolingDown = remainingSeconds > 0;

  if (!data || data.emailVerified || dismissed) {
    return null;
  }

  async function handleResend() {
    setResendState('sending');

    const res = await apiRequest('/auth/verify-email/resend', { method: 'POST' });

    if (res.status === 429) {
      const retryAfterSeconds = readRetryAfterSeconds(res) ?? DEFAULT_RETRY_AFTER_SECONDS;
      setRetryAfterAt(Date.now() + retryAfterSeconds * 1000);
      setResendState('idle');
      return;
    }

    if (!res.ok) {
      setResendState('error');
      return;
    }

    setResendState('sent');
  }

  const resendLabel = isCoolingDown ? `Resend in ${remainingSeconds}s` : resendState === 'sending' ? 'Sending…' : resendState === 'sent' ? 'Sent' : 'Resend verification email';

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-md bg-[var(--warning)]/15 px-lg py-xs text-caption text-[var(--warning)]"
    >
      <span>Verify your email to unlock all features.</span>

      <button
        type="button"
        onClick={handleResend}
        disabled={resendState === 'sending' || resendState === 'sent' || isCoolingDown}
        className="font-semibold underline disabled:opacity-60"
      >
        {resendLabel}
      </button>

      {resendState === 'error' && (
        <span role="alert" style={{ color: 'var(--danger)' }}>
          Couldn&apos;t resend the email. Please try again.
        </span>
      )}

      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-caption opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  );
}

// fe §9.2/Task 18.2 — persistent, dismissible, non-blocking banner shown on
// every authenticated route (mounted once at the root boundary — see
// BootSequence.tsx, the same leaf client boundary ImpersonationBanner
// already mounts from, per Task 16.1's note on why layout.tsx itself stays a
// Server Component). Sourced from `GET /me`'s `emailVerified` (useMe.ts,
// Task 18.1 — bootstrap's `UserSummaryDto` doesn't carry this field, so this
// is a genuinely separate request, deduped by TanStack Query against
// `/account/profile`'s own `useMe()` call when both are mounted). Dismissal
// is plain in-memory component state — never written to any storage — so it
// naturally "reappears next login": logging out clears `useAuthStore.user`
// (this returns null and unmounts), and a fresh sign-in remounts the
// `key={user.id}`'d content below with dismissed reset to false. Never a
// modal, never blocks navigation — architecture §6.5 is explicit no guard
// checks this value.
export function EmailVerifiedBanner() {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return null;
  }

  return <EmailVerifiedBannerContent key={user.id} />;
}
