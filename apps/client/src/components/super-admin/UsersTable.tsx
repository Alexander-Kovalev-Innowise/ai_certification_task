'use client';

import { createColumnHelper } from '@tanstack/react-table';
import Link from 'next/link';

import type { Role } from '../../types/auth';
import { ActionIconLink } from '../shared/ActionIcon';
import { DataTable } from '../shared/DataTable';
import { EmptyState } from '../shared/EmptyState';

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
  /** A refetch (filter/sort change) is in flight: dims rows + shows a progress bar without unmounting them. */
  isRefreshing?: boolean;
  /** When provided, the empty state offers a "Clear filters" button. */
  onClearFilters?: () => void;
}

const columnHelper = createColumnHelper<UserDirectoryRow>();

const columns = [
  columnHelper.display({
    id: 'name',
    header: 'Name',
    size: 220,
    minSize: 140,
    cell: ({ row }) => (
      <Link href={`/users/${row.original.id}`} className="truncate hover:underline">
        {row.original.firstName} {row.original.lastName}
      </Link>
    ),
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    size: 300,
    minSize: 160,
    cell: (info) => <span className="truncate">{info.getValue()}</span>,
  }),
  columnHelper.accessor('role', {
    header: 'Role',
    size: 190,
    minSize: 120,
    cell: (info) => <span className="badge badge-neutral">{info.getValue()}</span>,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    size: 140,
    minSize: 100,
    cell: (info) => {
      const status = info.getValue();
      return <span className={`badge ${status === 'ACTIVE' ? '' : status === 'DELETED' ? 'badge-danger' : 'badge-dark'}`}>{status}</span>;
    },
  }),
  columnHelper.display({
    id: 'actions',
    header: 'Actions',
    size: 96,
    enableResizing: false,
    meta: { align: 'right' },
    cell: ({ row }) => <ActionIconLink icon="edit" label="Edit user" href={`/users/${row.original.id}`} />,
  }),
];

// fe §4.3 — UsersTable. Each row exposes an explicit "Edit user" action (and a
// linked name) to `/users/:id` — "actual mutation happens on [id]" (fe §4.3's
// UserRowActions note), this table is read/navigate only. Rows are paginated
// client-side by the shared DataTable over the pages `useInfiniteQuery` has
// accumulated into `items`.
export function UsersTable({ items, hasMore, isFetchingNextPage = false, onLoadMore, isRefreshing = false, onClearFilters }: UsersTableProps) {
  return (
    <DataTable
      columns={columns}
      data={items}
      ariaLabel="Users"
      getRowId={(user) => user.id}
      rowAriaLabel={(user) => `${user.firstName} ${user.lastName}`}
      isRefreshing={isRefreshing}
      pagination={{ hasMore, isFetchingNextPage, onLoadMore }}
      emptyState={
        <EmptyState
          title="No users found."
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
