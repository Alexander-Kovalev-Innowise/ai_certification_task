'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { ApprovalRow } from '../../../src/components/player/ApprovalCard';
import { ApprovalDecisionModal } from '../../../src/components/player/ApprovalDecisionModal';
import { PendingApprovalsList } from '../../../src/components/player/PendingApprovalsList';
import { PendingApprovalsListSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { apiRequest } from '../../../src/lib/api/apiClient';
import { parseApiErrorBody } from '../../../src/lib/api/apiError';

interface ApprovalsResponse {
  items: ApprovalRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

// fe §4.6/§9.1 — a `typ: CHILD` token gets `403 CHILD_CAPABILITY_DENIED` on
// `GET /approvals` (api §4.6: "a child does not see the parent's approval
// queue"). The nav item is hidden for CHILD in `(player)/layout.tsx`
// already, so this only fires if the route is hit directly — the same
// "fallback redirect" role `RoleGuard` plays for role mismatches, just
// keyed on `accountType`/`errorCode` instead of `role`, since `RoleGuard`
// itself has no accountType concept (Task 14.1's ContextSwitcher work is
// the first place that distinction becomes real UI).
class ChildCapabilityDeniedError extends Error {}

async function fetchApprovals(): Promise<ApprovalsResponse> {
  const res = await apiRequest('/approvals?limit=100');

  if (res.status === 403) {
    const body = await parseApiErrorBody(res);
    if (body?.errorCode === 'CHILD_CAPABILITY_DENIED') {
      throw new ChildCapabilityDeniedError();
    }
  }
  if (!res.ok) {
    throw new Error(`GET /approvals failed with status ${res.status}`);
  }
  return (await res.json()) as ApprovalsResponse;
}

// fe §4.6 — `/approvals`: `GET /approvals`, approve/deny
// (`ApprovalDecisionModal`, `POST /approvals/:id/approve|/deny`) — adult
// parent only. Wrapped by `(player)/layout.tsx`'s RoleGuard(PLAYER_PARENT).
// Task 14.8.
export default function ApprovalsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [decisionTarget, setDecisionTarget] = useState<{ approval: ApprovalRow; decision: 'approve' | 'deny' } | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['approvals'],
    queryFn: fetchApprovals,
    retry: false,
  });

  const isChildDenied = error instanceof ChildCapabilityDeniedError;
  const isOtherError = !!error && !isChildDenied;

  useEffect(() => {
    if (isChildDenied) {
      router.replace('/dashboard');
    }
  }, [isChildDenied, router]);

  function openDecision(approvalId: string, decision: 'approve' | 'deny') {
    const approval = data?.items.find((item) => item.id === approvalId);
    if (!approval) {
      return;
    }
    setConflictMessage(null);
    setDecisionTarget({ approval, decision });
  }

  function handleResolved(updated: ApprovalRow) {
    queryClient.setQueryData(['approvals'], (previous: ApprovalsResponse | undefined) =>
      previous ? { ...previous, items: previous.items.map((item) => (item.id === updated.id ? updated : item)) } : previous,
    );
    void queryClient.invalidateQueries({ queryKey: ['me', 'bootstrap'] });
  }

  function handleConflict(_approvalId: string) {
    setConflictMessage('This request expired before your response was received.');
    void queryClient.invalidateQueries({ queryKey: ['approvals'] });
  }

  if (isLoading || isChildDenied) {
    return (
      <div className="p-lg">
        <PendingApprovalsListSkeleton />
      </div>
    );
  }

  if (isOtherError || !data) {
    return (
      <p role="alert" className="p-lg text-body text-[var(--danger)]">
        Something went wrong loading approvals. Please try again.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Approvals</h1>

      {conflictMessage && (
        <p role="status" className="text-body text-[var(--warning)]">
          {conflictMessage}
        </p>
      )}

      <PendingApprovalsList
        approvals={data.items}
        onApprove={(id) => openDecision(id, 'approve')}
        onDeny={(id) => openDecision(id, 'deny')}
      />

      <ApprovalDecisionModal
        isOpen={decisionTarget !== null}
        approval={decisionTarget?.approval ?? null}
        decision={decisionTarget?.decision ?? null}
        onClose={() => setDecisionTarget(null)}
        onResolved={handleResolved}
        onConflict={handleConflict}
      />
    </section>
  );
}
