'use client';

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnSizingState,
  type Header,
  type PaginationState,
  type RowData,
  type Table,
} from '@tanstack/react-table';
import { motion, useReducedMotion } from 'motion/react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { DataTablePagination } from './DataTablePagination';
import { EmptyState } from './EmptyState';
import { ScrollArea } from './ScrollArea';

declare module '@tanstack/react-table' {
  // Module augmentation must repeat the library's generic signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Horizontal alignment of header + cell content. */
    align?: 'left' | 'right' | 'center';
  }
}

export interface DataTablePaginationConfig {
  /** More rows exist server-side (cursor pagination: there is no total). */
  hasMore: boolean;
  isFetchingNextPage: boolean;
  /** Called when "Next" is pressed on the last loaded page and `hasMore` is true. */
  onLoadMore: () => void;
  /** Defaults to `[10, 25, 50, 100]`. */
  pageSizeOptions?: number[];
  /** Defaults to 25. */
  defaultPageSize?: number;
}

export interface DataTableProps<TData> {
  // Column helpers produce per-accessor value types (string, number, …), which
  // are not assignable to one `TValue`; `any` is the idiomatic TanStack escape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  ariaLabel: string;
  getRowId: (row: TData) => string;
  rowAriaLabel?: (row: TData) => string;
  rowClassName?: (row: TData) => string;
  /** Rendered between the table body and the pagination footer. */
  footer?: ReactNode;
  /** Client-side pagination over the rows loaded so far. Omit to render every row without a footer. */
  pagination?: DataTablePaginationConfig;
  /** Rendered (centered) in place of the body when `data` is empty; the header row stays visible. */
  emptyState?: ReactNode;
  /** A refetch is in flight: shows a progress bar, dims the (still mounted) rows and sets `aria-busy`. */
  isRefreshing?: boolean;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_COLUMN = { size: 160, minSize: 80, maxSize: 800 };
const KEYBOARD_RESIZE_STEP = 16;
/** The actions column is pinned last, fixed width, outside the resizable data columns. */
const ACTIONS_COLUMN_ID = 'actions';

// Header row height (min-h-11) - the overlay scrollbar starts below it.
const HEADER_HEIGHT = 44;

const ALIGN_CLASS = {
  left: 'justify-start text-left',
  right: 'justify-end text-right',
  center: 'justify-center text-center',
} as const;

function clampSize<TData>(column: Column<TData, unknown>, size: number): number {
  return Math.min(column.columnDef.maxSize ?? DEFAULT_COLUMN.maxSize, Math.max(column.columnDef.minSize ?? DEFAULT_COLUMN.minSize, size));
}

function RefreshBar() {
  const reduceMotion = useReducedMotion();
  return (
    <div aria-hidden="true" data-testid="table-refresh-bar" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-brand-primary/20">
      {reduceMotion ? (
        <div className="h-full w-full bg-brand-primary/70" />
      ) : (
        <motion.div
          className="h-full w-1/3 bg-brand-primary"
          initial={{ x: '-100%' }}
          animate={{ x: '300%' }}
          transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }}
        />
      )}
    </div>
  );
}

function ResizeHandle<TData>({ header, table }: { header: Header<TData, unknown>; table: Table<TData> }) {
  const { column } = header;
  const label = typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id;
  const resizeHandler = header.getResizeHandler();
  const size = column.getSize();

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
    table.setColumnSizing((previous) => ({ ...previous, [column.id]: clampSize(column, column.getSize() + delta) }));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={size}
      aria-valuemin={column.columnDef.minSize ?? DEFAULT_COLUMN.minSize}
      aria-valuemax={column.columnDef.maxSize ?? DEFAULT_COLUMN.maxSize}
      tabIndex={0}
      onMouseDown={resizeHandler}
      onTouchStart={resizeHandler}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => column.resetSize()}
      onClick={(event) => event.stopPropagation()}
      style={{ touchAction: 'none' }}
      className="group/resize absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none select-none justify-end outline-none"
    >
      <span
        aria-hidden="true"
        className={`my-sm w-0.5 rounded-full transition-colors ${
          column.getIsResizing()
            ? 'bg-brand-primary'
            : 'bg-ink/30 group-hover/resize:bg-brand-primary group-focus-visible/resize:bg-brand-primary'
        }`}
      />
    </div>
  );
}

// Shared table chrome for every list in the app: solid-filled container (the
// page's glow background must never bleed through), a solid, slightly
// different sticky header row, ARIA table/row/columnheader/cell semantics, a
// CSS grid template (data columns in exact px, a flexible filler, the actions
// column pinned to the right edge) so header and body cells line up, resizable
// columns, scrolling inside a max-height container, client-side pagination over
// the rows loaded so far, an empty state and a non-flickering refresh overlay.
// Built on TanStack Table's headless core.
export function DataTable<TData>({
  columns,
  data,
  ariaLabel,
  getRowId,
  rowAriaLabel,
  rowClassName,
  footer,
  pagination,
  emptyState,
  isRefreshing = false,
}: DataTableProps<TData>) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [pageState, setPageState] = useState<PaginationState>({ pageIndex: 0, pageSize: pagination?.defaultPageSize ?? DEFAULT_PAGE_SIZE });
  // Set while a "Next" on the last loaded page is waiting for new rows to arrive.
  const [pendingLoad, setPendingLoad] = useState<{ count: number; pageIndex: number } | null>(null);

  // Adjusting state during render (not in an effect): once the requested rows
  // arrive, hop onto the new page; drop the request if nothing more is coming.
  if (pendingLoad) {
    if (data.length > pendingLoad.count) {
      setPageState((previous) => ({ ...previous, pageIndex: pendingLoad.pageIndex }));
      setPendingLoad(null);
    } else if (!pagination?.hasMore || data.length < pendingLoad.count) {
      setPendingLoad(null);
    }
  }

  const pageSize = pageState.pageSize;
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));
  // Clamp (derived, not stored) so shrinking data — a filter change — never strands us past the end.
  const pageIndex = Math.min(pageState.pageIndex, pageCount - 1);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns unmemoizable functions; DataTable doesn't pass `table` to memoized children.
  const table = useReactTable({
    data,
    columns,
    getRowId,
    defaultColumn: DEFAULT_COLUMN,
    getCoreRowModel: getCoreRowModel(),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    autoResetPageIndex: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { columnSizing, pagination: { pageIndex, pageSize } },
    onColumnSizingChange: setColumnSizing,
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const leafColumns = table.getVisibleLeafColumns();
  const dataColumns = leafColumns.filter((column) => column.id !== ACTIONS_COLUMN_ID);
  const actionsColumn = leafColumns.find((column) => column.id === ACTIONS_COLUMN_ID);
  const gridTemplateColumns = [
    ...dataColumns.map((column) => `${column.getSize()}px`),
    'minmax(0, 1fr)',
    ...(actionsColumn ? [`${actionsColumn.getSize()}px`] : []),
  ].join(' ');
  const minInnerWidth = leafColumns.reduce((sum, column) => sum + column.getSize(), 0);
  // Explicit 1-based grid line per column so the actions cell skips the filler track.
  const gridColumnOf = (columnId: string) => {
    if (columnId === ACTIONS_COLUMN_ID) return dataColumns.length + 2;
    return dataColumns.findIndex((column) => column.id === columnId) + 1;
  };
  const isResizing = Boolean(table.getState().columnSizingInfo.isResizingColumn);
  const isEmpty = data.length === 0;

  function handlePageChange(nextIndex: number) {
    if (!pagination) return;
    if (nextIndex > pageCount - 1) {
      if (pagination.hasMore && !pagination.isFetchingNextPage) {
        setPendingLoad({ count: data.length, pageIndex: nextIndex });
        pagination.onLoadMore();
      }
      return;
    }
    setPendingLoad(null);
    setPageState((previous) => ({ ...previous, pageIndex: Math.max(0, nextIndex) }));
  }

  function handlePageSizeChange(nextSize: number) {
    setPendingLoad(null);
    // Keep the first visible row on screen after the page boundaries move.
    setPageState({ pageSize: nextSize, pageIndex: Math.floor((pageIndex * pageSize) / nextSize) });
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-border-soft bg-surface-1">
      {isRefreshing ? <RefreshBar /> : null}
      <ScrollArea
        insetTop={HEADER_HEIGHT}
        role="table"
        aria-label={ariaLabel}
        aria-busy={isRefreshing}
        className={`max-h-[min(65vh,40rem)] overflow-auto ${isResizing ? 'select-none' : ''}`}
      >
        <div style={{ minWidth: minInnerWidth }}>
          <div role="rowgroup" className={`sticky top-0 z-10 bg-surface-2 ${isResizing ? 'select-none' : ''}`}>
            {headerGroups.map((headerGroup) => (
              <div
                key={headerGroup.id}
                role="row"
                style={{ display: 'grid', gridTemplateColumns }}
                className="border-b border-border-soft"
              >
                {headerGroup.headers.map((header) => (
                  <div
                    key={header.id}
                    role="columnheader"
                    style={{ gridColumn: gridColumnOf(header.column.id) }}
                    className={`relative flex min-h-11 min-w-0 items-center px-md text-eyebrow font-semibold uppercase text-text-subtle ${ALIGN_CLASS[header.column.columnDef.meta?.align ?? 'left']}`}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {!header.isPlaceholder && header.column.getCanResize() ? <ResizeHandle header={header} table={table} /> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {isEmpty ? null : (
            <div role="rowgroup" className={isRefreshing ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
              {rows.map((row) => {
                const original = row.original;
                return (
                  <div
                    key={row.id}
                    role="row"
                    aria-label={rowAriaLabel?.(original)}
                    style={{ display: 'grid', gridTemplateColumns }}
                    className={`border-b border-border-soft/40 text-body text-text-primary last:border-b-0 hover:bg-surface-2 ${rowClassName?.(original) ?? ''}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        role="cell"
                        style={{ gridColumn: gridColumnOf(cell.column.id) }}
                        className={`flex min-h-[3.25rem] min-w-0 items-center px-md ${ALIGN_CLASS[cell.column.columnDef.meta?.align ?? 'left']}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {isEmpty ? (
        <div className="flex min-h-[26rem] w-full items-center justify-center px-lg">{emptyState ?? <EmptyState title="Nothing to show yet." icon="inbox" />}</div>
      ) : null}

      {footer}

      {pagination && !isEmpty ? (
        <DataTablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={pagination.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS}
          totalRows={data.length}
          hasMore={pagination.hasMore}
          isFetchingNextPage={pagination.isFetchingNextPage}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      ) : null}
    </div>
  );
}
