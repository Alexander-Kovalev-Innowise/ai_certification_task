'use client';

// api §4.3 GET /trainers/:id/players — `PaginatedResponseDto<RosterRowDto>`
// row shape verbatim: `{playerProfileId, name, age, availabilitySummary}`
// ONLY — deliberately no notes/tags/pipeline (architecture §18, FR-070's
// "Best Times" scheduling aid, not a full CRM).
export interface RosterRow {
  playerProfileId: string;
  name: string;
  age: number;
  availabilitySummary: string;
}

export interface PlayerRosterTableProps {
  items: RosterRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
}

// fe §4.4 — PlayerRosterTable: the trainer roster's minimal slice, same
// list-with-load-more shape as `CoachRosterTable` (Task 13.2). Task 14.9.
export function PlayerRosterTable({ items, hasMore, isFetchingNextPage = false, onLoadMore }: PlayerRosterTableProps) {
  if (items.length === 0) {
    return (
      <p role="status" className="p-lg text-body text-[var(--text-secondary)]">
        No players match this filter yet.
      </p>
    );
  }

  return (
    <div role="table" aria-label="Player roster" className="rounded-md border border-[var(--border-soft)]">
      {items.map((row) => (
        <div
          key={row.playerProfileId}
          role="row"
          aria-label={row.name}
          className="flex items-center gap-md border-b border-[var(--border-soft)]/40 p-md text-body text-[var(--text-primary)] last:border-b-0"
        >
          <span className="w-1/4 truncate">{row.name}</span>
          <span className="w-16 font-numeric text-[var(--text-secondary)]">{row.age}</span>
          <span className="flex-1 truncate text-caption text-[var(--text-secondary)]">{row.availabilitySummary || 'No availability set'}</span>
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
