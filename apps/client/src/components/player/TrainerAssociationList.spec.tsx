import { fireEvent, render, screen } from '@testing-library/react';

import { TrainerAssociationList, type TrainerAssociationRow } from './TrainerAssociationList';

const TRAINERS: TrainerAssociationRow[] = [
  { trainerId: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, connectedAt: '2026-01-01T00:00:00.000Z', status: 'ACTIVE' },
  { trainerId: 'trainer-2', businessName: 'Hoops Club', logoUrl: null, connectedAt: '2026-02-01T00:00:00.000Z', status: 'ACTIVE' },
];

// fe §4.6 — TrainerAssociationList: `/profiles/[id]`'s per-child trainer
// list (`GET /player-profiles/:id/trainers`), Add Trainer / Remove triggers
// — hidden for a CHILD session (`MANAGE_TRAINER_ASSOCIATIONS` is
// CHILD-denied, FR-051). The triggers only call back up to the page; the
// actual modals are Task 14.5's `AddTrainerModal`/`RemoveTrainerConfirmModal`.
// Task 14.4.
describe('TrainerAssociationList', () => {
  it('renders a row per trainer with business name and status', () => {
    render(<TrainerAssociationList trainers={TRAINERS} canManage onAddTrainer={jest.fn()} onRemoveTrainer={jest.fn()} />);

    expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument();
    expect(screen.getByText('Hoops Club')).toBeInTheDocument();
  });

  it('shows an empty state when there are no trainers', () => {
    render(<TrainerAssociationList trainers={[]} canManage onAddTrainer={jest.fn()} onRemoveTrainer={jest.fn()} />);

    expect(screen.getByText(/no trainers yet/i)).toBeInTheDocument();
  });

  it('calls onAddTrainer when "Add Trainer" is clicked, when canManage', () => {
    const onAddTrainer = jest.fn();
    render(<TrainerAssociationList trainers={TRAINERS} canManage onAddTrainer={onAddTrainer} onRemoveTrainer={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /add trainer/i }));
    expect(onAddTrainer).toHaveBeenCalled();
  });

  it('calls onRemoveTrainer with the row when "Remove" is clicked', () => {
    const onRemoveTrainer = jest.fn();
    render(<TrainerAssociationList trainers={TRAINERS} canManage onAddTrainer={jest.fn()} onRemoveTrainer={onRemoveTrainer} />);

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0] as HTMLElement);
    expect(onRemoveTrainer).toHaveBeenCalledWith(TRAINERS[0]);
  });

  it('hides Add Trainer / Remove triggers when canManage is false (CHILD session)', () => {
    render(<TrainerAssociationList trainers={TRAINERS} canManage={false} onAddTrainer={jest.fn()} onRemoveTrainer={jest.fn()} />);

    expect(screen.queryByRole('button', { name: /add trainer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});
