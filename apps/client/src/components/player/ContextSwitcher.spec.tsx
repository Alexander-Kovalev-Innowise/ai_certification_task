import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { useTrainerContextStore } from '../../stores/useTrainerContextStore';

import { ContextSwitcher, notifyTenantContextInvalid, type ContextEntry } from './ContextSwitcher';

function entry(overrides: Partial<ContextEntry> = {}): ContextEntry {
  return {
    playerProfileId: 'profile-1',
    playerProfileName: 'Sarah',
    isSelf: true,
    trainerId: 'trainer-1',
    trainerDisplayName: 'Coach Lisa',
    logoUrl: null,
    primaryColorHex: null,
    connectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSwitcher(props: Parameters<typeof ContextSwitcher>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <ContextSwitcher {...props} />
    </QueryClientProvider>,
  ) };
}

// fe §5.2/§US-01.04 — ContextSwitcher renders one of three documented
// formats chosen by accountType + whether any context has isSelf: true.
// Task 14.1.
describe('ContextSwitcher', () => {
  beforeEach(() => {
    useTrainerContextStore.getState().setActiveTrainerId(null);
  });

  it('renders the "parent who also trains" format: Me + children sections', () => {
    const contexts: ContextEntry[] = [
      entry({ trainerId: 'trainer-1', trainerDisplayName: 'Coach Lisa' }),
      entry({ trainerId: 'trainer-2', trainerDisplayName: 'Coach Mike' }),
      entry({ playerProfileId: 'profile-2', playerProfileName: 'Alex', isSelf: false, trainerId: 'trainer-3', trainerDisplayName: 'Coach Bob' }),
    ];

    renderSwitcher({ accountType: 'ADULT', contexts, activeContext: contexts[0] ?? null });

    expect(screen.getByTestId('context-switcher-current')).toHaveTextContent('Sarah (Me) → Coach Lisa');
    expect(screen.getByText(/your training:/i)).toHaveTextContent('Your Training: Sarah (Me) → Coach Lisa / Coach Mike');
    expect(screen.getByText(/your children's training:/i)).toHaveTextContent("Your Children's Training: Alex → Coach Bob");
  });

  it('renders the "parent who doesn\'t train" format: children section only, no Me section', () => {
    const contexts: ContextEntry[] = [
      entry({ playerProfileId: 'profile-2', playerProfileName: 'Alex', isSelf: false, trainerId: 'trainer-3', trainerDisplayName: 'Coach Bob' }),
      entry({ playerProfileId: 'profile-3', playerProfileName: 'Maya', isSelf: false, trainerId: 'trainer-3', trainerDisplayName: 'Coach Bob' }),
      entry({ playerProfileId: 'profile-3', playerProfileName: 'Maya', isSelf: false, trainerId: 'trainer-4', trainerDisplayName: 'Coach Lisa' }),
    ];

    renderSwitcher({ accountType: 'ADULT', contexts, activeContext: contexts[0] ?? null });

    expect(screen.getByTestId('context-switcher-current')).toHaveTextContent('Alex → Coach Bob');
    expect(screen.queryByText(/^your training:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/your children's training:/i)).toHaveTextContent(
      "Your Children's Training: Alex → Coach Bob · Maya → Coach Bob, Coach Lisa",
    );
  });

  it('renders the "child with own login" format: trainer list only, no Me/parent section', () => {
    const contexts: ContextEntry[] = [
      entry({ isSelf: false, trainerId: 'trainer-1', trainerDisplayName: 'Coach Bob' }),
      entry({ isSelf: false, trainerId: 'trainer-2', trainerDisplayName: 'Coach Lisa' }),
    ];

    renderSwitcher({ accountType: 'CHILD', contexts, activeContext: contexts[0] ?? null });

    expect(screen.getByTestId('context-switcher-current')).toHaveTextContent('Coach Bob');
    expect(screen.queryByText(/children/i)).not.toBeInTheDocument();
    expect(screen.getByText(/your training:/i)).toHaveTextContent('Your Training: Coach Bob · Coach Lisa');
  });

  it('selecting a context writes the trainerId to useTrainerContextStore and invalidates every query', () => {
    const contexts: ContextEntry[] = [
      entry({ trainerId: 'trainer-1', trainerDisplayName: 'Coach Lisa' }),
      entry({ trainerId: 'trainer-2', trainerDisplayName: 'Coach Mike' }),
    ];

    const { queryClient } = renderSwitcher({ accountType: 'ADULT', contexts, activeContext: contexts[0] ?? null });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const select = screen.getByLabelText(/active trainer context/i);
    fireEvent.change(select, { target: { value: 'profile-1::trainer-2' } });

    expect(useTrainerContextStore.getState().activeTrainerId).toBe('trainer-2');
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('shows a reconnect message and invalidates bootstrap when notified of an invalid tenant context', async () => {
    const contexts: ContextEntry[] = [entry()];
    const { queryClient } = renderSwitcher({ accountType: 'ADULT', contexts, activeContext: contexts[0] ?? null });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    notifyTenantContextInvalid();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer active/i);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me', 'bootstrap'] });
  });
});
