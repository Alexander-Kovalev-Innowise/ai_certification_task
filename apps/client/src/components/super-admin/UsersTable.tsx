'use client';

import { useState, type UIEvent } from 'react';

import type { Role } from '../../types/auth';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';

// api §3 GET /users — `PaginatedResponseDto<UserDirectoryRowDto>`'s row
// shape verbatim: `{ id, email, role, status, firstName, lastName,
// createdAt, lastLoginAt }`.
export interface UserDirectoryRow {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UsersTableProps {
  items: UserDirectoryRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  /**
   * Viewport height in px. Deliberately a fixed prop, not a DOM-measured
   * `clientHeight` — jsdom never performs real layout (clientHeight is
   * always 0 there), so measuring it would make the virtualization window
   * untestable. A fixed height keeps the windowing math identical in tests
   * and in a real browser.
   */
  height?: number;
}

const ROW_HEIGHT = 48;
const OVERSCAN = 4;
const LOAD_MORE_THRESHOLD = 200;
const DEFAULT_HEIGHT = 480;

// fe §4.3 — UsersTable, virtualized for the 10k-row NFR-002 target
// (Task 12.3): only rows inside (or just outside, via OVERSCAN) the visible
// window are mounted, no matter how many pages `useInfiniteQuery` has
// accumulated into `items`. Row navigation goes straight to `/users/:id` —
// "actual mutation happens on [id]" (fe §4.3's UserRowActions note), this
// table is read/navigate only.
export function UsersTable({ items, hasMore, isFetchingNextPage = false, onLoadMore, height = DEFAULT_HEIGHT }: UsersTableProps) {
  const [scrollTop, setScrollTop] = useState(0);

  if (items.length === 0) {
    return (
      <p role="status" className="p-lg text-body text-[var(--text-secondary)]">
        No users found.
      </p>
    );
  }

  const totalHeight = items.length * ROW_HEIGHT;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
  const lastVisible = Math.min(items.length, firstVisible + visibleCount);
  const visibleItems = items.slice(firstVisible, lastVisible);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    setScrollTop(nextScrollTop);

    // Computed from the known item count / configured height, not from
    // scrollHeight/clientHeight (see the `height` prop note above) — the
    // same reason this stays environment-independent.
    const distanceToBottom = totalHeight - nextScrollTop - height;
    if (distanceToBottom < LOAD_MORE_THRESHOLD && hasMore && !isFetchingNextPage) {
      onLoadMore();
    }
  }

  return (
    <div
      role="table"
      aria-label="Users"
      data-testid="users-table-viewport"
      onScroll={handleScroll}
      style={{ height, overflowY: 'auto', position: 'relative' }}
      className="rounded-md border border-[var(--border-soft)]"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((user, index) => {
          const top = (firstVisible + index) * ROW_HEIGHT;
          return (
            <a
              key={user.id}
              href={`/users/${user.id}`}
              role="row"
              style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_HEIGHT }}
              className="flex items-center gap-md border-b border-[var(--border-soft)]/40 px-md text-body text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
            >
              <span className="w-1/4 truncate">
                {user.firstName} {user.lastName}
              </span>
              <span className="w-1/4 truncate">{user.email}</span>
              <span className="w-1/6">{user.role}</span>
              <span className="w-1/6">{user.status}</span>
            </a>
          );
        })}
      </div>
      {isFetchingNextPage && (
        <p role="status" aria-live="polite" className="p-sm text-caption text-[var(--text-secondary)]">
          Loading more…
        </p>
      )}
    </div>
  );
}
