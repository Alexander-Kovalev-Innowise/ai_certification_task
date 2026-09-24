'use client';

import { CoachStatusBadge, type CoachInvitationStatus } from './CoachStatusBadge';

// api §4.2 GET /trainers/:id/coaches — `PaginatedResponseDto<CoachRosterRowDto>`
// row shape verbatim. `userId`/`name`/`joinedAt` are `null` for a
// still-outstanding ShareLink(COACH_UNIQUE) invite with no CoachProfile yet;
// `status` is the raw underlying enum (CoachStatus for a real profile, the
// literal 'PENDING'/'EXPIRED' string for an invite-only row) — distinct from
// `invitationStatus`, the roster's own derived Pending/Accepted/Expired.
export interface CoachRosterRow {
  id: string;
  userId: string | null;
  name: string | null;
  email: string;
  status: string;
  bio?: string | null;
  joinedAt: string | null;
  invitationStatus: CoachInvitationStatus;
}

export interface ResendTarget {
  email: string;
  name: string | null;
}

export interface CoachRosterTableProps {
  items: CoachRosterRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  /** PATCH /coaches/:id { status } — trainer's own allowed field (api §4.2). */
  onStatusChange: (coachId: string, nextStatus: 'ACTIVE' | 'PENDING') => void;
  /** Re-runs POST /coaches/invite for an expired, not-yet-accepted invite. */
  onResend: (target: ResendTarget) => void;
}

// fe §4.4 — CoachRosterTable: `GET /trainers/:id/coaches` roster, a
// CoachStatusBadge per row, an ACTIVE/PENDING status toggle for accepted
// coaches (PATCH /coaches/:id, trainer's allowed field only), and a
// resend-on-expiry action for invites with no CoachProfile yet. Task 13.2.
export function CoachRosterTable({ items, hasMore, isFetchingNextPage = false, onLoadMore, onStatusChange, onResend }: CoachRosterTableProps) {
  if (items.length === 0) {
    return (
      <p role="status" className="p-lg text-body text-[var(--text-secondary)]">
        No coaches yet — invite one to get started.
      </p>
    );
  }

  return (
    <div role="table" aria-label="Coach roster" className="rounded-md border border-[var(--border-soft)]">
      {items.map((row) => {
        const displayName = row.name ?? row.email;
        const canToggleStatus = row.userId !== null && row.invitationStatus === 'Accepted';
        const nextStatus = row.status === 'ACTIVE' ? 'PENDING' : 'ACTIVE';
        const canResend = row.userId === null && row.invitationStatus === 'Expired';

        return (
          <div
            key={row.id}
            role="row"
            aria-label={displayName}
            className="flex items-center gap-md border-b border-[var(--border-soft)]/40 p-md text-body text-[var(--text-primary)] last:border-b-0"
          >
            <span className="w-1/4 truncate">{displayName}</span>
            <span className="w-1/4 truncate">{row.email}</span>
            <span className="w-1/6">
              <CoachStatusBadge status={row.invitationStatus} />
            </span>
            <span className="w-1/6 text-caption text-[var(--text-secondary)]">
              {row.joinedAt ? new Date(row.joinedAt).toLocaleDateString() : '—'}
            </span>
            <span className="flex flex-1 justify-end gap-sm">
              {canToggleStatus && (
                <button
                  type="button"
                  onClick={() => onStatusChange(row.id, nextStatus)}
                  className="rounded-sm border border-[var(--border-soft)] p-xxs text-caption text-[var(--text-primary)] hover:border-[var(--brand-primary)]"
                >
                  Set to {nextStatus === 'ACTIVE' ? 'Active' : 'Pending'}
                </button>
              )}
              {canResend && (
                <button
                  type="button"
                  onClick={() => onResend({ email: row.email, name: row.name })}
                  className="rounded-sm border border-[var(--border-soft)] p-xxs text-caption text-[var(--text-primary)] hover:border-[var(--brand-primary)]"
                >
                  Resend invite
                </button>
              )}
            </span>
          </div>
        );
      })}

      {hasMore && (
        <div className="p-sm text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="rounded-sm p-sm text-body text-[var(--brand-primary)] disabled:opacity-60"
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
