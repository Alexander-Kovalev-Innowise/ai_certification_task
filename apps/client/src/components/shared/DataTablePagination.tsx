'use client';

import { useId } from 'react';

export type PageItem = number | 'gap-start' | 'gap-end';

/**
 * Windowed page list (0-based indices): first, last and the neighbours of the
 * current page, with an ellipsis standing in for each skipped run. Short lists
 * are shown in full.
 */
export function getPageItems(pageCount: number, current: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);

  const wanted = new Set<number>([0, pageCount - 1, current - 1, current, current + 1]);
  if (current <= 2) [1, 2, 3].forEach((page) => wanted.add(page));
  if (current >= pageCount - 3) [pageCount - 4, pageCount - 3, pageCount - 2].forEach((page) => wanted.add(page));

  const pages = [...wanted].filter((page) => page >= 0 && page < pageCount).sort((a, b) => a - b);
  const items: PageItem[] = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && page - previous > 1) {
      items.push(previous < current ? 'gap-start' : 'gap-end');
    }
    items.push(page);
  });
  return items;
}

export interface DataTablePaginationProps {
  pageIndex: number;
  pageSize: number;
  pageSizeOptions: number[];
  /** Rows loaded so far (not the server total — the APIs are cursor-based). */
  totalRows: number;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const PILL =
  'inline-flex h-[34px] min-w-[34px] items-center justify-center rounded-full border border-border-soft bg-surface-2 px-xs text-caption font-semibold text-ink transition-colors hover:border-brand-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary';
// Ring (not a fill) so the number keeps the theme's text colour: light on dark, dark on light.
const PILL_ACTIVE = 'border-brand-primary ring-1 ring-brand-primary';

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={direction === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className="animate-spin motion-reduce:animate-none"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

// Footer of the shared DataTable: "Showing a–b of N(+)", a rows-per-page select
// and a numbered page nav. Pure presentation — all paging state lives in
// DataTable.
export function DataTablePagination({
  pageIndex,
  pageSize,
  pageSizeOptions,
  totalRows,
  hasMore,
  isFetchingNextPage,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const selectId = useId();
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const first = pageIndex * pageSize + 1;
  const last = Math.min(totalRows, (pageIndex + 1) * pageSize);
  const isLastLoadedPage = pageIndex >= pageCount - 1;
  const nextDisabled = isFetchingNextPage || (isLastLoadedPage && !hasMore);
  const options = pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-lg gap-y-sm border-t border-border-soft bg-surface-1 px-md py-sm">
      <div className="flex flex-wrap items-center gap-x-md gap-y-xs text-caption text-text-secondary">
        <span aria-live="polite">
          Showing {first}–{last} of {totalRows}
          {hasMore ? '+' : ''}
        </span>
        <label htmlFor={selectId} className="flex items-center gap-xs">
          <span>Rows per page</span>
          <select
            id={selectId}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-[34px] min-h-0 rounded-full py-0 pl-md pr-[2.5rem] text-caption font-semibold"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-sm">
        {isFetchingNextPage ? (
          <span aria-live="polite" className="inline-flex items-center gap-xs text-caption text-text-secondary">
            <Spinner />
            Loading…
          </span>
        ) : null}
        <nav aria-label="Pagination" className="flex flex-wrap items-center gap-xs">
          <button type="button" aria-label="Previous page" disabled={pageIndex <= 0} onClick={() => onPageChange(pageIndex - 1)} className={PILL}>
            <Chevron direction="left" />
          </button>
          {getPageItems(pageCount, pageIndex).map((item) =>
            typeof item === 'number' ? (
              <button
                key={item}
                type="button"
                aria-label={`Page ${item + 1}`}
                aria-current={item === pageIndex ? 'page' : undefined}
                onClick={() => onPageChange(item)}
                className={`${PILL} ${item === pageIndex ? PILL_ACTIVE : ''}`.trim()}
              >
                {item + 1}
              </button>
            ) : (
              <span key={item} aria-hidden="true" className="inline-flex h-[34px] min-w-[20px] items-center justify-center text-caption text-text-subtle">
                …
              </span>
            ),
          )}
          <button type="button" aria-label="Next page" disabled={nextDisabled} onClick={() => onPageChange(pageIndex + 1)} className={PILL}>
            <Chevron direction="right" />
          </button>
        </nav>
      </div>
    </div>
  );
}
