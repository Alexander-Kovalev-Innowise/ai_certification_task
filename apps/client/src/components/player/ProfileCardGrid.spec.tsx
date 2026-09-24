import { fireEvent, render, screen } from '@testing-library/react';

import { ProfileCardGrid, type PlayerProfileSummary } from './ProfileCardGrid';

const PROFILES: PlayerProfileSummary[] = [
  { id: 'profile-1', name: 'Priya', isSelf: true, trainerCount: 2, photoUrl: null },
  { id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1, photoUrl: null },
];

// fe §4.6 — ProfileCardGrid: `/profiles` page's self + children grid, each
// card linking to `/profiles/[id]`, an "Add Child" trigger (hidden for a
// CHILD session — MANAGE_CHILD_PROFILES is CHILD-denied, api §4.3). Task 14.3.
describe('ProfileCardGrid', () => {
  it('renders a card per profile, linking to /profiles/[id]', () => {
    render(<ProfileCardGrid profiles={PROFILES} canAddChild onAddChild={jest.fn()} />);

    expect(screen.getByRole('link', { name: /priya/i })).toHaveAttribute('href', '/profiles/profile-1');
    expect(screen.getByRole('link', { name: /alex/i })).toHaveAttribute('href', '/profiles/profile-2');
  });

  it('labels the self profile as "Me"', () => {
    render(<ProfileCardGrid profiles={PROFILES} canAddChild onAddChild={jest.fn()} />);

    expect(screen.getByText(/^me$/i)).toBeInTheDocument();
  });

  it('shows the trainerCount for each profile', () => {
    render(<ProfileCardGrid profiles={PROFILES} canAddChild onAddChild={jest.fn()} />);

    expect(screen.getByText(/2 trainers/i)).toBeInTheDocument();
    expect(screen.getByText(/1 trainer\b/i)).toBeInTheDocument();
  });

  it('shows an "Add Child" trigger and calls onAddChild when clicked, for an ADULT session', () => {
    const onAddChild = jest.fn();
    render(<ProfileCardGrid profiles={PROFILES} canAddChild onAddChild={onAddChild} />);

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));
    expect(onAddChild).toHaveBeenCalled();
  });

  it('hides the "Add Child" trigger for a CHILD session (MANAGE_CHILD_PROFILES is CHILD-denied)', () => {
    render(<ProfileCardGrid profiles={[PROFILES[0] as PlayerProfileSummary]} canAddChild={false} onAddChild={jest.fn()} />);

    expect(screen.queryByRole('button', { name: /add child/i })).not.toBeInTheDocument();
  });
});
