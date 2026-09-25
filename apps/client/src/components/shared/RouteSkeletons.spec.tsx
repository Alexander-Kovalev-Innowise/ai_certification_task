import { render, screen } from '@testing-library/react';

import {
  AvailabilityGridSkeleton,
  CoachRosterTableSkeleton,
  PendingApprovalsListSkeleton,
  PlayerRosterTableSkeleton,
  ProfileCardGridSkeleton,
  ShareLinkTableSkeleton,
  UsersTableSkeleton,
} from './RouteSkeletons';

// fe §9.5/Task 18.4 — route-specific skeletons, "built once per route's
// actual shape ... not a single generic shimmer block reused everywhere."
// Each of these matches the real component's own `role`/row-or-card
// structure (verified against UsersTable.tsx/CoachRosterTable.tsx/
// ShareLinkTable.tsx/PlayerRosterTable.tsx/AvailabilityGrid.tsx/
// ProfileCardGrid.tsx/PendingApprovalsList.tsx), reusing the `SkeletonRow`/
// `SkeletonCard`/`SkeletonGridCell` primitives from Task 10.9.
describe('RouteSkeletons', () => {
  it('UsersTableSkeleton renders a role="table" with placeholder rows', () => {
    render(<UsersTableSkeleton />);
    expect(screen.getByRole('table', { name: /loading users/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
  });

  it('CoachRosterTableSkeleton renders a role="table" with placeholder rows', () => {
    render(<CoachRosterTableSkeleton />);
    expect(screen.getByRole('table', { name: /loading coach roster/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
  });

  it('ShareLinkTableSkeleton renders a role="table" with placeholder rows', () => {
    render(<ShareLinkTableSkeleton />);
    expect(screen.getByRole('table', { name: /loading share links/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
  });

  it('PlayerRosterTableSkeleton renders a role="table" with placeholder rows', () => {
    render(<PlayerRosterTableSkeleton />);
    expect(screen.getByRole('table', { name: /loading player roster/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
  });

  it('AvailabilityGridSkeleton renders a role="grid" with one placeholder row per day (7)', () => {
    render(<AvailabilityGridSkeleton />);
    expect(screen.getByRole('grid', { name: /loading availability/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(7);
  });

  it('ProfileCardGridSkeleton renders several card-shaped placeholders', () => {
    const { container } = render(<ProfileCardGridSkeleton />);
    expect(screen.getByLabelText(/loading profiles/i)).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('PendingApprovalsListSkeleton renders several card-shaped placeholders', () => {
    render(<PendingApprovalsListSkeleton />);
    expect(screen.getByLabelText(/loading approvals/i)).toBeInTheDocument();
  });
});
