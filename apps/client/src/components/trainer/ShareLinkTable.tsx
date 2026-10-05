'use client';

import { createColumnHelper } from '@tanstack/react-table';

import { DataTable } from '../shared/DataTable';
import { EmptyState } from '../shared/EmptyState';

import { RevokeConfirmPopover } from './RevokeConfirmPopover';

// api §4.4 GET /trainers/:id/share-links — `PaginatedResponseDto<ShareLinkRowDto>`
// row shape verbatim.
export type ShareLinkRowType = 'PLAYER_STATIC' | 'COACH_UNIQUE';
export type ShareLinkRowStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ShareLinkRow {
  id: string;
  code: string;
  type: ShareLinkRowType;
  targetEmail?: string | null;
  status: ShareLinkRowStatus;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ShareLinkTableProps {
  items: ShareLinkRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  /** DELETE /share-links/:id, confirmed via RevokeConfirmPopover. */
  onRevoke: (id: string) => void;
  /**
   * fe §9.4 — optimistic revoke: the `/share-links` page marks an id here the
   * instant the mutation fires (before the server responds), this table
   * fades that row, and the page rolls the id back out on failure. Kept as
   * an id set the page owns (not internal state) so the optimistic-update
   * source of truth stays at the mutation, not scattered into this
   * presentational table.
   */
  pendingRevokeIds?: string[];
  /** A refetch is in flight: dims rows + shows a progress bar without unmounting them. */
  isRefreshing?: boolean;
}

const TYPE_LABEL: Record<ShareLinkRowType, string> = {
  PLAYER_STATIC: 'Player — Static',
  COACH_UNIQUE: 'Coach — Unique',
};

const columnHelper = createColumnHelper<ShareLinkRow>();

// fe §4.4 — ShareLinkTable: code, type, usage, expiry, status (api §4.4).
// PLAYER_STATIC links are unlimited-use/no-expiry (BR-006) — rendered as
// "Never" rather than a blank cell; COACH_UNIQUE links show their
// `targetEmail` and 7-day `expiresAt`. Revoke is offered for ACTIVE links
// only, via RevokeConfirmPopover (icon trigger in the actions column).
// There is no share-link edit route, so there is no edit link. Task 13.3.
export function ShareLinkTable({
  items,
  hasMore,
  isFetchingNextPage = false,
  onLoadMore,
  onRevoke,
  pendingRevokeIds = [],
  isRefreshing = false,
}: ShareLinkTableProps) {
  const columns = [
    columnHelper.accessor('code', {
      header: 'Code',
      size: 160,
      minSize: 100,
      cell: (info) => <span className="truncate font-mono">{info.getValue()}</span>,
    }),
    columnHelper.accessor('type', {
      header: 'Type',
      size: 200,
      minSize: 120,
      cell: (info) => <span className="truncate">{TYPE_LABEL[info.getValue()]}</span>,
    }),
    columnHelper.accessor('targetEmail', {
      header: 'Target email',
      size: 260,
      minSize: 140,
      cell: (info) => <span className="truncate">{info.getValue() ?? '—'}</span>,
    }),
    columnHelper.accessor('useCount', {
      header: 'Uses',
      size: 90,
      minSize: 70,
      meta: { align: 'center' },
      cell: (info) => <span>{info.getValue()}</span>,
    }),
    columnHelper.accessor('expiresAt', {
      header: 'Expires',
      size: 140,
      minSize: 100,
      cell: (info) => {
        const expiresAt = info.getValue();
        return <span className="text-caption text-text-secondary">{expiresAt ? new Date(expiresAt).toLocaleDateString() : 'Never'}</span>;
      },
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      size: 110,
      minSize: 90,
      cell: (info) => <span>{info.getValue()}</span>,
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      size: 96,
      enableResizing: false,
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.status === 'ACTIVE' ? (
          <RevokeConfirmPopover variant="icon" onConfirm={() => onRevoke(row.original.id)} disabled={pendingRevokeIds.includes(row.original.id)} />
        ) : null,
    }),
  ];

  return (
    <DataTable
      columns={columns}
      data={items}
      ariaLabel="Share links"
      getRowId={(row) => row.id}
      rowAriaLabel={(row) => row.code}
      rowClassName={(row) => (pendingRevokeIds.includes(row.id) ? 'opacity-40' : '')}
      isRefreshing={isRefreshing}
      pagination={{ hasMore, isFetchingNextPage, onLoadMore }}
      emptyState={
        <EmptyState
          icon="inbox"
          title="No share links yet — generate one to start inviting players or coaches."
          description="Generated links will show up here so you can track and revoke them."
        />
      }
    />
  );
}
