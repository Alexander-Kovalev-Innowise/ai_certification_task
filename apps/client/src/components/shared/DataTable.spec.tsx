import { createColumnHelper } from '@tanstack/react-table';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { ActionIconButton, ActionIconLink } from './ActionIcon';
import { DataTable } from './DataTable';
import { EmptyState } from './EmptyState';

interface Item {
  id: string;
  name: string;
}

type TableProps = ComponentProps<typeof DataTable<Item>>;

const columnHelper = createColumnHelper<Item>();

const onDelete = jest.fn();

const columns = [
  columnHelper.accessor('name', { header: 'Name', cell: (info) => info.getValue() }),
  columnHelper.display({
    id: 'actions',
    header: 'Actions',
    size: 96,
    enableResizing: false,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <>
        <ActionIconLink icon="edit" label="Edit item" href={`/items/${row.original.id}`} />
        <ActionIconButton icon="trash" label="Delete item" onClick={() => onDelete(row.original.id)} />
      </>
    ),
  }),
];

const data: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({ id: `i${index}`, name: `Item ${index}` }));
}

function renderTable(props: Partial<TableProps> = {}) {
  return render(<DataTable columns={columns} data={data} ariaLabel="Items" getRowId={(item) => item.id} {...props} />);
}

function paginationProps(overrides: Partial<NonNullable<TableProps['pagination']>> = {}) {
  return { hasMore: false, isFetchingNextPage: false, onLoadMore: jest.fn(), ...overrides };
}

const bodyRowCount = () => screen.getAllByRole('row').length - 1;

describe('DataTable', () => {
  it('renders a header row with the column names', () => {
    renderTable();

    expect(screen.getByRole('table', { name: 'Items' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Actions']);
  });

  it('renders a row and cells per data item', () => {
    renderTable();

    // header row + 2 body rows
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('cell')).toHaveLength(4);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('uses a solid (non-transparent) container and header background', () => {
    renderTable();

    const container = screen.getByRole('table', { name: 'Items' }).closest('.bg-surface-1');
    expect(container).toHaveClass('bg-surface-1');
    expect(container?.className).not.toMatch(/bg-\S*\/\d+|bg-transparent/);
    expect(screen.getAllByRole('columnheader')[0]?.closest('[role="rowgroup"]')).toHaveClass('bg-surface-2', 'sticky');
  });

  it('applies one shared grid template (data columns in px, filler, pinned actions) to the header and body rows', () => {
    renderTable();

    const [headerRow, bodyRow] = screen.getAllByRole('row');
    expect(headerRow?.style.gridTemplateColumns).toBe('160px minmax(0, 1fr) 96px');
    expect(bodyRow?.style.gridTemplateColumns).toBe('160px minmax(0, 1fr) 96px');
  });

  it('places the actions cell after the filler track', () => {
    renderTable();

    const [nameCell, actionsCell] = screen.getAllByRole('cell');
    expect(nameCell?.style.gridColumn).toBe('1');
    expect(actionsCell?.style.gridColumn).toBe('3');
  });

  it('scrolls inside the container (native bar hidden, overlay bar drawn instead) with a max height', () => {
    renderTable();

    const table = screen.getByRole('table', { name: 'Items' });
    expect(table).toHaveClass('scroll-hide-native', 'overflow-auto');
    expect(table.className).toMatch(/max-h-/);
  });

  it('renders an actions column with labelled icon controls', () => {
    renderTable();

    const edit = screen.getAllByRole('link', { name: 'Edit item' })[0];
    expect(edit).toHaveAttribute('href', '/items/a');
    expect(edit).toHaveAttribute('title', 'Edit item');

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete item' }).at(1) as HTMLElement);
    expect(onDelete).toHaveBeenCalledWith('b');
  });

  it('applies rowAriaLabel and rowClassName to body rows', () => {
    renderTable({
      rowAriaLabel: (item) => `Item ${item.name}`,
      rowClassName: (item) => (item.id === 'b' ? 'opacity-40' : ''),
    });

    expect(screen.getByRole('row', { name: 'Item Alpha' })).not.toHaveClass('opacity-40');
    expect(screen.getByRole('row', { name: 'Item Beta' })).toHaveClass('opacity-40');
  });

  it('renders the footer below the table body', () => {
    renderTable({ footer: <p>Custom footer</p> });

    expect(screen.getByText('Custom footer')).toBeInTheDocument();
  });

  describe('pagination', () => {
    it('shows no footer when pagination is not configured', () => {
      renderTable();

      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    });

    it('paginates 25 rows per page by default and reports the range', () => {
      renderTable({ data: makeItems(60), pagination: paginationProps() });

      expect(bodyRowCount()).toBe(25);
      expect(screen.getByText('Showing 1–25 of 60')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    });

    it('changes the page size', () => {
      renderTable({ data: makeItems(60), pagination: paginationProps() });

      fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '10' } });

      expect(bodyRowCount()).toBe(10);
      expect(screen.getByText('Showing 1–10 of 60')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Page 6' })).toBeInTheDocument();
    });

    it('honours defaultPageSize and pageSizeOptions', () => {
      renderTable({ data: makeItems(60), pagination: paginationProps({ defaultPageSize: 5, pageSizeOptions: [5, 20] }) });

      expect(bodyRowCount()).toBe(5);
      expect(within(screen.getByLabelText('Rows per page')).getAllByRole('option').map((option) => option.textContent)).toEqual(['5', '20']);
    });

    it('moves between pages with next / previous / numbered buttons', () => {
      renderTable({ data: makeItems(60), pagination: paginationProps() });

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(screen.getByText('Showing 26–50 of 60')).toBeInTheDocument();
      expect(screen.getByText('Item 25')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
      expect(screen.getByText('Showing 51–60 of 60')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
      expect(screen.getByText('Showing 26–50 of 60')).toBeInTheDocument();
    });

    it('windows many pages with an ellipsis', () => {
      renderTable({ data: makeItems(300), pagination: paginationProps({ defaultPageSize: 10 }) });

      expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Page 30' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Page 15' })).not.toBeInTheDocument();
    });

    it('appends "+" to the total when more rows exist server-side', () => {
      renderTable({ data: makeItems(50), pagination: paginationProps({ hasMore: true }) });

      expect(screen.getByText('Showing 1–25 of 50+')).toBeInTheDocument();
    });

    it('calls onLoadMore from "Next" on the last loaded page, then moves to the new page once rows arrive', () => {
      const onLoadMore = jest.fn();
      const pagination = paginationProps({ hasMore: true, onLoadMore });
      const { rerender } = render(<DataTable columns={columns} data={makeItems(25)} ariaLabel="Items" getRowId={(item) => item.id} pagination={pagination} />);

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Showing 1–25 of 25+')).toBeInTheDocument();

      rerender(<DataTable columns={columns} data={makeItems(50)} ariaLabel="Items" getRowId={(item) => item.id} pagination={{ ...pagination, hasMore: false }} />);
      expect(screen.getByText('Showing 26–50 of 50')).toBeInTheDocument();
    });

    it('shows a loading label and disables "Next" while the next page is fetching', () => {
      renderTable({ data: makeItems(25), pagination: paginationProps({ hasMore: true, isFetchingNextPage: true }) });

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });

    it('disables "Next" on the last page when nothing more can be loaded', () => {
      renderTable({ data: makeItems(25), pagination: paginationProps() });

      expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });

    it('clamps the page when the data shrinks', () => {
      const pagination = paginationProps({ defaultPageSize: 10 });
      const { rerender } = render(<DataTable columns={columns} data={makeItems(60)} ariaLabel="Items" getRowId={(item) => item.id} pagination={pagination} />);

      fireEvent.click(screen.getByRole('button', { name: 'Page 6' }));
      expect(screen.getByText('Showing 51–60 of 60')).toBeInTheDocument();

      rerender(<DataTable columns={columns} data={makeItems(12)} ariaLabel="Items" getRowId={(item) => item.id} pagination={pagination} />);
      expect(screen.getByText('Showing 11–12 of 12')).toBeInTheDocument();
      expect(bodyRowCount()).toBe(2);
    });
  });

  describe('column resizing', () => {
    it('gives each resizable header a keyboard-accessible separator, but not the actions column', () => {
      renderTable();

      const handle = screen.getByRole('separator', { name: 'Resize Name column' });
      expect(handle).toHaveAttribute('aria-orientation', 'vertical');
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(screen.getAllByRole('separator')).toHaveLength(1);
    });

    it('resizes by 16px per arrow key and updates the shared grid template', () => {
      renderTable();
      const handle = screen.getByRole('separator', { name: 'Resize Name column' });
      const [headerRow, bodyRow] = screen.getAllByRole('row');

      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      expect(headerRow?.style.gridTemplateColumns).toBe('176px minmax(0, 1fr) 96px');
      expect(bodyRow?.style.gridTemplateColumns).toBe('176px minmax(0, 1fr) 96px');

      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      expect(headerRow?.style.gridTemplateColumns).toBe('144px minmax(0, 1fr) 96px');
    });

    it('never shrinks a column below its minimum size', () => {
      renderTable();
      const handle = screen.getByRole('separator', { name: 'Resize Name column' });

      for (let index = 0; index < 20; index += 1) fireEvent.keyDown(handle, { key: 'ArrowLeft' });

      expect(screen.getAllByRole('row')[0]?.style.gridTemplateColumns).toBe('80px minmax(0, 1fr) 96px');
    });
  });

  describe('empty state', () => {
    it('renders the empty state under a visible header and hides pagination', () => {
      renderTable({
        data: [],
        emptyState: (
          <EmptyState title="Nothing here" description="Try later" action={<button type="button">Clear filters</button>} />
        ),
        pagination: paginationProps(),
      });

      expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Actions']);
      expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('cell')).toHaveLength(0);
    });

    it('falls back to a generic empty state when none is given', () => {
      renderTable({ data: [] });

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('refreshing', () => {
    it('is not busy by default', () => {
      renderTable();

      expect(screen.getByRole('table', { name: 'Items' })).toHaveAttribute('aria-busy', 'false');
      expect(screen.queryByTestId('table-refresh-bar')).not.toBeInTheDocument();
    });

    it('keeps rows mounted, dims them and shows a progress bar while refreshing', () => {
      renderTable({ isRefreshing: true });

      expect(screen.getByRole('table', { name: 'Items' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId('table-refresh-bar')).toBeInTheDocument();
      expect(screen.getByText('Alpha').closest('[role="rowgroup"]')).toHaveClass('opacity-60', 'pointer-events-none');
    });
  });
});
