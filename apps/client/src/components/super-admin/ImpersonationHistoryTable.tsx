'use client';

import { createColumnHelper } from '@tanstack/react-table';

import type { UserSummaryDto } from '../../types/auth';
import { DataTable } from '../shared/DataTable';
import { EmptyState } from '../shared/EmptyState';

// api §2 GET /impersonation/history — `ImpersonationLogResponseDto` row
// shape verbatim: `{ id, admin: UserSummaryDto, target: UserSummaryDto,
// startedAt, endedAt, durationSeconds }`.
export interface ImpersonationHistoryRow {
  id: string;
  admin: UserSummaryDto;
  target: UserSummaryDto;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface ImpersonationHistoryTableProps {
  items: ImpersonationHistoryRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  /** A refetch is in flight: dims rows + shows a progress bar without unmounting them. */
  isRefreshing?: boolean;
  /** When provided, the empty state offers a "Clear filters" button. */
  onClearFilters?: () => void;
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const columnHelper = createColumnHelper<ImpersonationHistoryRow>();

// This audit log is read-only and has no edit route, so (unlike UsersTable)
// there is deliberately no actions column.
const columns = [
  columnHelper.display({
    id: 'admin',
    header: 'Admin',
    size: 200,
    minSize: 120,
    cell: ({ row }) => (
      <span className="truncate">
        {row.original.admin.firstName} {row.original.admin.lastName}
      </span>
    ),
  }),
  columnHelper.display({
    id: 'target',
    header: 'Target',
    size: 260,
    minSize: 140,
    cell: ({ row }) => (
      <span className="truncate">
        {row.original.target.firstName} {row.original.target.lastName} ({row.original.target.role})
      </span>
    ),
  }),
  columnHelper.accessor('startedAt', {
    header: 'Started',
    size: 190,
    minSize: 140,
    cell: (info) => <span className="text-caption text-text-secondary">{new Date(info.getValue()).toLocaleString()}</span>,
  }),
  columnHelper.accessor('endedAt', {
    header: 'Ended',
    size: 190,
    minSize: 140,
    cell: (info) => {
      const endedAt = info.getValue();
      return <span className="text-caption text-text-secondary">{endedAt ? new Date(endedAt).toLocaleString() : 'In progress'}</span>;
    },
  }),
  columnHelper.accessor('durationSeconds', {
    header: 'Duration',
    size: 120,
    minSize: 90,
    meta: { align: 'right' },
    cell: (info) => {
      const durationSeconds = info.getValue();
      return <span className="font-numeric text-caption">{durationSeconds !== null ? formatDuration(durationSeconds) : '—'}</span>;
    },
  }),
];

// fe §5.1/api §2 — ImpersonationHistoryTable: paginated client-side by the
// shared DataTable over the pages loaded so far. A session still
// `endedAt: null` (either genuinely in progress, or swept up by
// `ImpersonationMaintenanceJob`'s 10-minute cron before an explicit `/end`
// call — api §2's "stale-impersonation safety net") reads as "In progress"
// rather than a blank cell. Task 16.2.
export function ImpersonationHistoryTable({
  items,
  hasMore,
  isFetchingNextPage = false,
  onLoadMore,
  isRefreshing = false,
  onClearFilters,
}: ImpersonationHistoryTableProps) {
  return (
    <DataTable
      columns={columns}
      data={items}
      ariaLabel="Impersonation history"
      getRowId={(entry) => entry.id}
      rowAriaLabel={(entry) => `${entry.admin.firstName} ${entry.admin.lastName}`}
      isRefreshing={isRefreshing}
      pagination={{ hasMore, isFetchingNextPage, onLoadMore }}
      emptyState={
        <EmptyState
          title="No impersonation sessions found."
          description="No records match your filters. Try adjusting or clearing them."
          action={
            onClearFilters ? (
              <button type="button" onClick={onClearFilters} className="btn btn-secondary btn-sm">
                Clear filters
              </button>
            ) : undefined
          }
        />
      }
    />
  );
}
