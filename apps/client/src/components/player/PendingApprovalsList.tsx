'use client';

import { useState } from 'react';

import { ApprovalCard, type ApprovalRow } from './ApprovalCard';

export interface PendingApprovalsListProps {
  approvals: ApprovalRow[];
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function resolvedRecently(approval: ApprovalRow, now: number): boolean {
  if (approval.status === 'PENDING') {
    return false;
  }
  const resolvedAt = approval.respondedAt ?? approval.requestedAt;
  return now - new Date(resolvedAt).getTime() <= SEVEN_DAYS_MS;
}

/**
 * fe §9.1 — PendingApprovalsList: `/approvals`' main list. Empty state
 * ("No pending approvals — you're all caught up") is not a bare
 * "no results" — it's shown whenever there are zero `PENDING` rows,
 * regardless of whether a "recently resolved" section also renders below
 * it, so the page isn't a dead end the one time a parent has nothing to
 * decide. Task 14.8.
 */
export function PendingApprovalsList({ approvals, onApprove, onDeny }: PendingApprovalsListProps) {
  // `lib/api/authSession.ts`'s pattern: `Date.now()` read once via
  // `useState`'s lazy initializer (evaluated at mount, not on every render)
  // rather than called directly in the component body, which
  // `react-hooks/purity` flags as an impure render. This list's "last 7
  // days" window doesn't need to tick live the way `ApprovalCard`'s
  // per-approval countdown does, so a single mount-time read is enough.
  const [now] = useState(() => Date.now());
  const pending = approvals.filter((approval) => approval.status === 'PENDING');
  const recentlyResolved = approvals.filter((approval) => resolvedRecently(approval, now));

  return (
    <div className="flex flex-col gap-md">
      {pending.length === 0 ? (
        <p role="status" className="text-body text-[var(--text-secondary)]">
          No pending approvals — you&apos;re all caught up.
        </p>
      ) : (
        <div className="flex flex-col gap-sm">
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onApprove={() => onApprove(approval.id)} onDeny={() => onDeny(approval.id)} />
          ))}
        </div>
      )}

      {recentlyResolved.length > 0 && (
        <details className="rounded-md border border-[var(--border-soft)] p-sm">
          <summary className="cursor-pointer text-body text-[var(--text-secondary)]">Recently resolved (last 7 days)</summary>
          <div className="mt-sm flex flex-col gap-sm">
            {recentlyResolved.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
