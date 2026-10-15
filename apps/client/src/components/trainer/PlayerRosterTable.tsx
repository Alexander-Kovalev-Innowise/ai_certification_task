'use client';

import { createColumnHelper } from '@tanstack/react-table';

import { SKILL_LEVELS, skillLevelLabel, type SkillLevel } from '../../lib/skillLevel';
import { ActionIconButton } from '../shared/ActionIcon';
import { DataTable } from '../shared/DataTable';
import { EmptyState } from '../shared/EmptyState';

// api §4.3 GET /trainers/:id/players — `PaginatedResponseDto<RosterRowDto>`
// row shape verbatim: `{playerProfileId, name, age, availabilitySummary}`
// plus the trainer-set `skillLevel` (spec US-01.11) — deliberately no
// notes/tags/pipeline (architecture §18, FR-070's "Best Times" scheduling
// aid, not a full CRM).
export interface RosterRow {
  playerProfileId: string;
  name: string;
  age: number;
  skillLevel?: string;
  availabilitySummary: string;
}

export interface PlayerRosterTableProps {
  items: RosterRow[];
  hasMore: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  /** A refetch is in flight: dims rows + shows a progress bar without unmounting them. */
  isRefreshing?: boolean;
  /** When provided, the empty state offers a "Clear filters" button. */
  onClearFilters?: () => void;
  /** When provided, each row gets a "Remove" icon action (Epic §3 "Manage own organization users"). */
  onRemove?: (row: RosterRow) => void;
  /** When provided, the skill level is a select the trainer can change (spec US-01.11: "trainer sets this"). */
  onSkillLevelChange?: (row: RosterRow, skillLevel: SkillLevel) => void;
}

const columnHelper = createColumnHelper<RosterRow>();

function buildBaseColumns(onSkillLevelChange: PlayerRosterTableProps['onSkillLevelChange']) {
  return [
    columnHelper.accessor('name', {
      header: 'Player',
      size: 220,
      minSize: 140,
      cell: (info) => <span className="truncate">{info.getValue()}</span>,
    }),
    columnHelper.accessor('age', {
      header: 'Age',
      size: 80,
      minSize: 70,
      cell: (info) => <span className="font-numeric text-text-secondary">{info.getValue()}</span>,
    }),
    columnHelper.accessor('skillLevel', {
      header: 'Skill level',
      size: 170,
      minSize: 120,
      cell: ({ row }) =>
        onSkillLevelChange ? (
          <select
            aria-label={`Skill level for ${row.original.name}`}
            className="min-w-0"
            value={row.original.skillLevel ?? ''}
            onChange={(event) => onSkillLevelChange(row.original, event.target.value as SkillLevel)}
          >
            {!row.original.skillLevel && <option value="">Not set</option>}
            {SKILL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {skillLevelLabel(level)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-caption text-text-secondary">{skillLevelLabel(row.original.skillLevel) || 'Not set'}</span>
        ),
    }),
    columnHelper.accessor('availabilitySummary', {
      header: 'Availability',
      size: 380,
      minSize: 200,
      cell: (info) => <span className="truncate text-caption text-text-secondary">{info.getValue() || 'No availability set'}</span>,
    }),
  ];
}

// fe §4.4 — PlayerRosterTable: the trainer roster's minimal slice, same
// paginated-list shape as `CoachRosterTable` (Task 13.2). Task 14.9.
export function PlayerRosterTable({
  items,
  hasMore,
  isFetchingNextPage = false,
  onLoadMore,
  isRefreshing = false,
  onClearFilters,
  onRemove,
  onSkillLevelChange,
}: PlayerRosterTableProps) {
  const baseColumns = buildBaseColumns(onSkillLevelChange);
  const columns = onRemove
    ? [
        ...baseColumns,
        columnHelper.display({
          id: 'actions',
          header: 'Actions',
          size: 96,
          enableResizing: false,
          meta: { align: 'right' },
          cell: ({ row }) => (
            <span className="flex justify-end gap-xs">
              <ActionIconButton icon="user-x" tone="danger" label={`Remove ${row.original.name}`} onClick={() => onRemove(row.original)} />
            </span>
          ),
        }),
      ]
    : baseColumns;

  return (
    <DataTable
      columns={columns}
      data={items}
      ariaLabel="Player roster"
      getRowId={(row) => row.playerProfileId}
      rowAriaLabel={(row) => row.name}
      isRefreshing={isRefreshing}
      pagination={{ hasMore, isFetchingNextPage, onLoadMore }}
      emptyState={
        <EmptyState
          title="No players match this filter yet."
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
