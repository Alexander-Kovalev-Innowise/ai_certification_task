'use client';

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
}

const TYPE_LABEL: Record<ShareLinkRowType, string> = {
  PLAYER_STATIC: 'Player — Static',
  COACH_UNIQUE: 'Coach — Unique',
};

// fe §4.4 — ShareLinkTable: code, type, usage, expiry, status (api §4.4).
// PLAYER_STATIC links are unlimited-use/no-expiry (BR-006) — rendered as
// "Never" rather than a blank cell; COACH_UNIQUE links show their
// `targetEmail` and 7-day `expiresAt`. Revoke is offered for ACTIVE links
// only, via RevokeConfirmPopover. Task 13.3.
export function ShareLinkTable({ items, hasMore, isFetchingNextPage = false, onLoadMore, onRevoke, pendingRevokeIds = [] }: ShareLinkTableProps) {
  if (items.length === 0) {
    return (
      <p role="status" className="p-lg text-body text-[var(--text-secondary)]">
        No share links yet — generate one to start inviting players or coaches.
      </p>
    );
  }

  return (
    <div role="table" aria-label="Share links" className="rounded-md border border-[var(--border-soft)]">
      {items.map((row) => {
        const isPending = pendingRevokeIds.includes(row.id);

        return (
          <div
            key={row.id}
            role="row"
            aria-label={row.code}
            className={`flex items-center gap-md border-b border-[var(--border-soft)]/40 p-md text-body text-[var(--text-primary)] last:border-b-0 ${isPending ? 'opacity-40' : ''}`}
          >
            <span className="w-1/6 truncate font-mono">{row.code}</span>
            <span className="w-1/6">{TYPE_LABEL[row.type]}</span>
            <span className="w-1/5 truncate">{row.targetEmail ?? '—'}</span>
            <span className="w-1/12 text-center">{row.useCount}</span>
            <span className="w-1/6 text-caption text-[var(--text-secondary)]">
              {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : 'Never'}
            </span>
            <span className="w-1/12">{row.status}</span>
            <span className="flex flex-1 justify-end">
              {row.status === 'ACTIVE' && <RevokeConfirmPopover onConfirm={() => onRevoke(row.id)} disabled={isPending} />}
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
