import { SkeletonCard, SkeletonGridCell, SkeletonRow } from './Skeleton';

const DEFAULT_ROW_COUNT = 6;

interface TableSkeletonProps {
  label: string;
  /** Tailwind width class per column, in real-table column order. */
  columnWidths: string[];
  rowCount?: number;
}

/**
 * fe §9.5/Task 18.4 — internal building block shared by the four
 * route-specific TABLE skeletons below. Column widths are wrapper `<div>`s
 * around a plain `SkeletonRow`, not width classes passed into `SkeletonRow`
 * directly — `SkeletonRow` already carries `w-full` in its own base
 * classes (Skeleton.tsx), and two conflicting Tailwind width utilities on
 * the same element resolve by CSS source order, not JSX order, which is not
 * a bet worth making for something as visible as layout-matching skeletons.
 * Each real table (`UsersTable`/`CoachRosterTable`/`ShareLinkTable`/
 * `PlayerRosterTable`) is `role="table"` > `role="row"` `<div>`s, not a
 * `<table>` element — matched here for real, not coincidentally.
 */
function TableSkeleton({ label, columnWidths, rowCount = DEFAULT_ROW_COUNT }: TableSkeletonProps) {
  return (
    <div role="table" aria-label={`Loading ${label}`} aria-busy="true" className="rounded-md border border-[var(--border-soft)]">
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <div key={rowIndex} role="row" className="flex items-center gap-md border-b border-[var(--border-soft)]/40 p-md last:border-b-0">
          {columnWidths.map((width, columnIndex) => (
            <div key={columnIndex} className={width}>
              <SkeletonRow />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** fe §4.3/§9.5 — matches UsersTable.tsx's real columns: name, email, role, status. */
export function UsersTableSkeleton() {
  return <TableSkeleton label="users" columnWidths={['w-1/4', 'w-1/4', 'w-1/6', 'w-1/6']} />;
}

/** fe §4.4/§9.5 — matches CoachRosterTable.tsx's real columns: name, email, status badge, joined date, trailing actions. */
export function CoachRosterTableSkeleton() {
  return <TableSkeleton label="coach roster" columnWidths={['w-1/4', 'w-1/4', 'w-1/6', 'w-1/6', 'flex-1']} />;
}

/** fe §4.4/§9.5 — matches ShareLinkTable.tsx's real columns: code, type, target email, use count, expiry, status. */
export function ShareLinkTableSkeleton() {
  return <TableSkeleton label="share links" columnWidths={['w-1/6', 'w-1/6', 'w-1/5', 'w-1/12', 'w-1/6', 'w-1/12']} />;
}

/** fe §4.4/§9.5 — matches PlayerRosterTable.tsx's real columns: name, age, availability summary. */
export function PlayerRosterTableSkeleton() {
  return <TableSkeleton label="player roster" columnWidths={['w-1/4', 'w-16', 'flex-1']} />;
}

const AVAILABILITY_DAY_COUNT = 7;

/**
 * fe §5.4/§9.5 — matches AvailabilityGrid.tsx's real `view`/`edit` shape:
 * `role="grid"` with one `role="row"` per day (Sun-Sat), NOT a day x
 * time-slot matrix (verified against the real component — each day row
 * renders a single line summarizing that day's ranges, not a per-slot grid
 * of cells).
 */
export function AvailabilityGridSkeleton() {
  return (
    <div role="grid" aria-label="Loading availability" aria-busy="true" className="flex flex-col gap-xs">
      {Array.from({ length: AVAILABILITY_DAY_COUNT }, (_, index) => (
        <div key={index} role="row" className="flex items-center gap-md">
          <div className="w-16">
            <SkeletonRow />
          </div>
          <div className="flex-1">
            <SkeletonRow />
          </div>
        </div>
      ))}
    </div>
  );
}

const PROFILE_CARD_COUNT = 4;

/** fe §4.6/§9.5 — matches ProfileCardGrid.tsx's real `w-48` cards: circular photo, name line, caption line. */
export function ProfileCardGridSkeleton() {
  return (
    <div aria-label="Loading profiles" aria-busy="true" className="flex flex-wrap gap-md">
      {Array.from({ length: PROFILE_CARD_COUNT }, (_, index) => (
        <div key={index} className="flex w-48 flex-col gap-xxs rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft">
          <div className="h-12 w-12 overflow-hidden rounded-full">
            <SkeletonGridCell />
          </div>
          <SkeletonRow className="h-4 w-3/4" />
          <SkeletonRow className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

const APPROVAL_CARD_COUNT = 3;

/** fe §9.1/§9.5 — matches PendingApprovalsList.tsx's real ApprovalCard stack shape (a vertical list of cards, not one bare block). */
export function PendingApprovalsListSkeleton() {
  return (
    <div aria-label="Loading approvals" aria-busy="true" className="flex flex-col gap-sm">
      {Array.from({ length: APPROVAL_CARD_COUNT }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
