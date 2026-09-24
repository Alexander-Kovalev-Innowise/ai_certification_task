'use client';

import { useEffect, useState } from 'react';

// api §4.6 ApprovalRowDto, reproduced verbatim.
export interface ApprovalRow {
  id: string;
  playerProfileId: string;
  playerName: string;
  eventId: string;
  amount: string;
  paymentType: 'USD' | 'TOKEN';
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  requestedAt: string;
  expiresAt: string;
  respondedAt?: string | null;
  parentNotes?: string | null;
}

export interface ApprovalCardProps {
  approval: ApprovalRow;
  onApprove?: () => void;
  onDeny?: () => void;
}

const HOUR_MS = 60 * 60 * 1000;
const TICK_MS = 30_000;

/**
 * A ticking clock, following the `lib/api/authSession.ts` pattern for
 * `Date.now()` calls: the initial read happens inside `useState`'s lazy
 * initializer (evaluated once, at mount — not on every render, which is
 * what `react-hooks/purity` actually flags), and every subsequent read
 * happens inside a `setInterval` callback (a timer callback, not render).
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) {
    return 'Expiring…';
  }
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
}

const CARD_CLASSNAME = 'flex flex-col gap-xxs rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft';

/**
 * fe §9.1 — ApprovalCard: per-status rendering table.
 * - `PENDING`: live countdown to `expiresAt` (48h window, api §4.6), `caption`-size,
 *   `--warning` once under 6h remaining, `--danger` once under 1h. Approve/Deny active.
 * - `APPROVED`/`DENIED`: `--success`/`--danger` badge, decision timestamp, notes if present. No actions.
 * - `EXPIRED`: distinct muted treatment — copy "Expired — no response within 48 hours" — this is
 *   system-generated (`ApprovalExpiryJob`), not a parent decision, and must not read as an active denial.
 * Task 14.8.
 */
export function ApprovalCard({ approval, onApprove, onDeny }: ApprovalCardProps) {
  const now = useNow(TICK_MS);

  if (approval.status === 'PENDING') {
    const remainingMs = new Date(approval.expiresAt).getTime() - now;
    const color = remainingMs <= HOUR_MS ? 'var(--danger)' : remainingMs <= 6 * HOUR_MS ? 'var(--warning)' : 'var(--text-secondary)';

    return (
      <div role="article" aria-label={approval.playerName} className={CARD_CLASSNAME}>
        <p className="text-body-lg font-semibold text-[var(--text-primary)]">
          {approval.playerName} — {approval.amount} {approval.paymentType}
        </p>
        <p data-testid="approval-countdown" className="font-numeric text-caption" style={{ color }}>
          {formatRemaining(remainingMs)}
        </p>
        <div className="mt-xs flex gap-sm">
          <button
            type="button"
            onClick={onApprove}
            className="rounded-sm bg-[var(--success)] p-xxs text-caption font-semibold text-[#0D0D0D]"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onDeny}
            className="rounded-sm border border-[var(--border-soft)] p-xxs text-caption text-[var(--danger)] hover:border-[var(--danger)]"
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  if (approval.status === 'EXPIRED') {
    return (
      <div role="article" aria-label={approval.playerName} className={`${CARD_CLASSNAME} opacity-60`}>
        <p className="text-body-lg font-semibold text-[var(--text-secondary)]">
          {approval.playerName} — {approval.amount} {approval.paymentType}
        </p>
        <p className="text-caption text-[var(--text-secondary)]">Expired — no response within 48 hours</p>
      </div>
    );
  }

  const badgeColor = approval.status === 'APPROVED' ? 'var(--success)' : 'var(--danger)';

  return (
    <div role="article" aria-label={approval.playerName} className={CARD_CLASSNAME}>
      <p className="text-body-lg font-semibold text-[var(--text-primary)]">
        {approval.playerName} — {approval.amount} {approval.paymentType}
      </p>
      <span className="text-caption font-semibold" style={{ color: badgeColor }}>
        {approval.status}
      </span>
      {approval.respondedAt && <span className="text-caption text-[var(--text-secondary)]">{new Date(approval.respondedAt).toLocaleString()}</span>}
      {approval.parentNotes && <p className="text-caption text-[var(--text-secondary)]">{approval.parentNotes}</p>}
    </div>
  );
}
