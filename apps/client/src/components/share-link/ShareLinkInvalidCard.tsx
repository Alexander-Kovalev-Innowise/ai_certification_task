// fe §4.2 — GET /share-links/:code's `reason` values, exact copy per the
// deep-dive table. `undefined` (no reason at all) covers the one case the
// server never actually produces: a network-level failure reaching this far
// without a parsed preview body (ShareLinkDispatcher's catch/non-ok branch)
// — distinct generic copy, not silently mislabeled as NOT_FOUND.
export type ShareLinkInvalidReason = 'EXPIRED' | 'REVOKED' | 'EXHAUSTED' | 'NOT_FOUND';

const REASON_COPY: Record<ShareLinkInvalidReason, string> = {
  NOT_FOUND: "This invitation link doesn't exist.",
  EXPIRED: 'This invitation link has expired. Ask your trainer for a new one.',
  EXHAUSTED: 'This invitation link has already been used.',
  REVOKED: 'This invitation link is no longer active.',
};

const GENERIC_ERROR_COPY = 'Something went wrong loading this invitation link. Please try again.';

export interface ShareLinkInvalidCardProps {
  reason?: ShareLinkInvalidReason;
}

// fe §4.2 — never a generic Next.js not-found page (api §4.4 designed the
// public preview specifically so the client can be this precise about why).
export function ShareLinkInvalidCard({ reason }: ShareLinkInvalidCardProps) {
  const message = reason ? REASON_COPY[reason] : GENERIC_ERROR_COPY;

  return (
    <div
      role="alert"
      className="flex flex-col gap-sm rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg text-center"
    >
      <p className="text-body text-[var(--text-primary)]">{message}</p>
    </div>
  );
}
