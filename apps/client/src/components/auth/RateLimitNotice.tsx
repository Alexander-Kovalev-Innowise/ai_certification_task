// api §0.6 — every auth form that hits auth-ip/auth-identity/token-consume
// throttles can get a 429 back with a Retry-After header (seconds). Shared,
// presentational-only: the caller decides *when* to render it (typically
// after catching a 429 in its own submit handler) and passes the parsed
// seconds along, per apiError.ts's readRetryAfterSeconds.
export interface RateLimitNoticeProps {
  retryAfterSeconds?: number | null;
}

export function RateLimitNotice({ retryAfterSeconds }: RateLimitNoticeProps) {
  return (
    <div
      role="alert"
      className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-sm text-body text-[var(--warning)]"
    >
      Too many attempts.{' '}
      {retryAfterSeconds ? `Please try again in ${retryAfterSeconds} seconds.` : 'Please try again shortly.'}
    </div>
  );
}
