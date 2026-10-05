'use client';

import { createColumnHelper } from '@tanstack/react-table';

import { ActionIconButton } from '../shared/ActionIcon';
import { DataTable } from '../shared/DataTable';
import { EmptyState } from '../shared/EmptyState';

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
  /** Invite-only rows: when the link expires (Pending) / expired (Expired). */
  expiresAt?: string | null;
  invitationStatus: CoachInvitationStatus;
}

export interface CoachRosterTableProps {
  items: CoachRosterRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  /** PATCH /coaches/:id { status } — trainer's own allowed field (api §4.2). */
  onStatusChange: (coachId: string, nextStatus: 'ACTIVE' | 'PENDING') => void;
  /** POST /coaches/invites/:id/resend for a not-yet-accepted invite row (Pending or Expired). */
  onResend: (row: CoachRosterRow) => void;
  /** Opens the "Check availability / Assign to session" flow for an ACTIVE coach. */
  onAssign?: (row: CoachRosterRow) => void;
  /** Opens the "Remove coach" confirmation for a coach with an account. */
  onRemove?: (row: CoachRosterRow) => void;
  /** A refetch is in flight: dims rows + shows a progress bar without unmounting them. */
  isRefreshing?: boolean;
}

const columnHelper = createColumnHelper<CoachRosterRow>();

// fe §4.4 — CoachRosterTable: `GET /trainers/:id/coaches` roster, a
// CoachStatusBadge per row, an ACTIVE/PENDING status toggle for accepted
// coaches (PATCH /coaches/:id, trainer's allowed field only), and a
// resend action for invites with no CoachProfile yet (Pending or Expired),
// an availability-check/assign action and a remove action for coaches that
// have an account. Task 13.2 + Epic-01 audit (US-01.08/01.10, Epic §3).
// Actions render as labelled icon buttons in the actions column; there is no
// coach edit route, so there is no edit link.
export function CoachRosterTable({
  items,
  hasMore,
  isFetchingNextPage = false,
  onLoadMore,
  onStatusChange,
  onResend,
  onAssign,
  onRemove,
  isRefreshing = false,
}: CoachRosterTableProps) {
  const columns = [
    columnHelper.display({
      id: 'name',
      header: 'Name',
      size: 220,
      minSize: 140,
      cell: ({ row }) => <span className="truncate">{row.original.name ?? row.original.email}</span>,
    }),
    columnHelper.accessor('email', {
      header: 'Email',
      size: 300,
      minSize: 160,
      cell: (info) => <span className="truncate">{info.getValue()}</span>,
    }),
    columnHelper.accessor('invitationStatus', {
      header: 'Status',
      size: 180,
      minSize: 120,
      cell: ({ row }) => {
        const { invitationStatus, expiresAt } = row.original;
        const caption =
          invitationStatus === 'Pending' && expiresAt
            ? `Expires ${new Date(expiresAt).toLocaleDateString()}`
            : invitationStatus === 'Expired' && expiresAt
              ? `Expired ${new Date(expiresAt).toLocaleDateString()}`
              : null;
        return (
          <span className="flex flex-col items-start gap-xxs">
            <CoachStatusBadge status={invitationStatus} />
            {caption && <span className="text-caption text-text-secondary">{caption}</span>}
          </span>
        );
      },
    }),
    columnHelper.accessor('joinedAt', {
      header: 'Joined',
      size: 140,
      minSize: 100,
      cell: (info) => {
        const joinedAt = info.getValue();
        return <span className="text-caption text-text-secondary">{joinedAt ? new Date(joinedAt).toLocaleDateString() : '—'}</span>;
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      size: 156,
      enableResizing: false,
      meta: { align: 'right' },
      cell: ({ row }) => {
        const coach = row.original;
        const canToggleStatus = coach.userId !== null && coach.invitationStatus === 'Accepted';
        const nextStatus = coach.status === 'ACTIVE' ? 'PENDING' : 'ACTIVE';
        // Any not-yet-accepted invite row (no account yet) can be resent: the
        // server revokes the old link and issues a fresh 7-day one.
        const canResend = coach.userId === null && coach.invitationStatus !== 'Accepted';
        const canAssign = coach.userId !== null && coach.status === 'ACTIVE' && !!onAssign;
        const canRemove = coach.userId !== null && !!onRemove;
        const displayName = coach.name ?? coach.email;

        return (
          <span className="flex justify-end gap-xs">
            {canToggleStatus && (
              <ActionIconButton
                icon="toggle"
                label={`Set to ${nextStatus === 'ACTIVE' ? 'Active' : 'Pending'}`}
                onClick={() => onStatusChange(coach.id, nextStatus)}
              />
            )}
            {canAssign && (
              <ActionIconButton icon="calendar" label={`Check availability / Assign ${displayName} to session`} onClick={() => onAssign?.(coach)} />
            )}
            {canResend && <ActionIconButton icon="refresh" label="Resend invite" onClick={() => onResend(coach)} />}
            {canRemove && (
              <ActionIconButton icon="user-x" tone="danger" label={`Remove ${displayName}`} onClick={() => onRemove?.(coach)} />
            )}
          </span>
        );
      },
    }),
  ];

  return (
    <DataTable
      columns={columns}
      data={items}
      ariaLabel="Coach roster"
      getRowId={(row) => row.id}
      rowAriaLabel={(row) => row.name ?? row.email}
      isRefreshing={isRefreshing}
      pagination={{ hasMore, isFetchingNextPage, onLoadMore }}
      emptyState={
        <EmptyState icon="inbox" title="No coaches yet — invite one to get started." description="Invited coaches will show up here once you send an invite." />
      }
    />
  );
}
