'use client';

import { Card } from '../shared/Card';
import { EmptyState } from '../shared/EmptyState';

// `GET /me/purchase-requests` row — same ApprovalRowDto the guardian sees.
export interface PurchaseRequestRow {
  id: string;
  title?: string | null;
  amount: string;
  paymentType: 'USD' | 'TOKEN';
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  requestedAt: string;
  expiresAt: string;
  respondedAt?: string | null;
  parentNotes?: string | null;
  infoRequestMessage?: string | null;
}

const STATUS_BADGE: Record<PurchaseRequestRow['status'], { label: string; className: string }> = {
  PENDING: { label: 'Pending Parent Approval', className: 'badge badge-neutral' },
  APPROVED: { label: 'Confirmed', className: 'badge' },
  DENIED: { label: 'Denied', className: 'badge badge-danger' },
  EXPIRED: { label: 'Expired', className: 'badge badge-dark' },
};

export function formatRequestAmount(amount: string, paymentType: 'USD' | 'TOKEN'): string {
  const value = Number(amount);
  const text = Number.isFinite(value) ? value.toFixed(2) : amount;
  return paymentType === 'USD' ? `$${text}` : `${text} tokens`;
}

export interface PurchaseRequestListProps {
  requests: PurchaseRequestRow[];
}

// `/requests` main list (CHILD sessions only): the child's own purchase
// requests with a Pending / Confirmed / Denied / Expired badge, the guardian's
// notes and — while a request is still pending — any "more info" question.
export function PurchaseRequestList({ requests }: PurchaseRequestListProps) {
  if (requests.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="No requests yet"
        description="When you ask your parent to buy something, it will show up here with its status."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-sm" aria-label="My requests">
      {requests.map((request) => {
        const badge = STATUS_BADGE[request.status];
        return (
          <li key={request.id}>
            <Card className="flex flex-col gap-xxs !p-md">
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <p className="text-body-lg font-semibold text-ink">{request.title || 'Purchase request'}</p>
                <span className={badge.className}>{badge.label}</span>
              </div>
              <p className="font-numeric text-body text-ink-muted">{formatRequestAmount(request.amount, request.paymentType)}</p>
              <p className="text-caption text-text-subtle">Requested {new Date(request.requestedAt).toLocaleString()}</p>
              {request.status === 'PENDING' && request.infoRequestMessage && (
                <p className="text-body text-warning">Your parent asked: {request.infoRequestMessage}</p>
              )}
              {request.parentNotes && <p className="text-caption text-ink-muted">Note from your parent: {request.parentNotes}</p>}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
