'use client';

import type { UserSummaryDto } from '../../types/auth';

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
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

// fe §5.1/api §2 — ImpersonationHistoryTable: plain "Load more" pagination
// (mirrors ShareLinkTable's non-virtualized list, Task 13.3) rather than
// UsersTable's virtualized windowing (Task 12.3) — this audit list has no
// NFR-002-style 10k-row target the way `/users` does. A session still
// `endedAt: null` (either genuinely in progress, or swept up by
// `ImpersonationMaintenanceJob`'s 10-minute cron before an explicit `/end`
// call — api §2's "stale-impersonation safety net") reads as "In progress"
// rather than a blank cell. Task 16.2.
export function ImpersonationHistoryTable({ items, hasMore, isFetchingNextPage = false, onLoadMore }: ImpersonationHistoryTableProps) {
  if (items.length === 0) {
    return (
      <p role="status" className="p-lg text-body text-[var(--text-secondary)]">
        No impersonation sessions found.
      </p>
    );
  }

  return (
    <div role="table" aria-label="Impersonation history" className="rounded-md border border-[var(--border-soft)]">
      {items.map((entry) => (
        <div
          key={entry.id}
          role="row"
          aria-label={`${entry.admin.firstName} ${entry.admin.lastName}`}
          className="flex flex-wrap items-center gap-md border-b border-[var(--border-soft)]/40 p-md text-body text-[var(--text-primary)] last:border-b-0"
        >
          <span className="w-1/4 truncate">
            {entry.admin.firstName} {entry.admin.lastName}
          </span>
          <span className="w-1/4 truncate">
            {entry.target.firstName} {entry.target.lastName} ({entry.target.role})
          </span>
          <span className="w-1/5 text-caption text-[var(--text-secondary)]">{new Date(entry.startedAt).toLocaleString()}</span>
          <span className="w-1/5 text-caption text-[var(--text-secondary)]">
            {entry.endedAt ? new Date(entry.endedAt).toLocaleString() : 'In progress'}
          </span>
          <span className="flex-1 text-right font-numeric text-caption">
            {entry.durationSeconds !== null ? formatDuration(entry.durationSeconds) : '—'}
          </span>
        </div>
      ))}

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
