import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ProfilePage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function bootstrapBody() {
  return {
    role: 'COACH',
    user: { id: 'coach-user-1', email: 'cory@example.com', role: 'COACH', accountType: 'ADULT', firstName: 'Cory', lastName: 'Coach', mustChangePassword: false },
    coachProfile: { id: 'coach-1', userId: 'coach-user-1', trainerId: 'trainer-1', status: 'ACTIVE', bio: 'Loves tennis', credentials: null, certifications: null, publicProfile: false },
    employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, primaryColorHex: null },
    availabilitySet: true,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

// fe §4.5 — `/profile` (Coach): `PATCH /coaches/:id` (self-fields branch),
// `CoachProfileForm` prefilled from `GET /me/bootstrap`'s COACH shape's
// `coachProfile` — no separate `GET /coaches/:id` round trip exists (there
// is no single-resource coach GET endpoint), same "the bootstrap response IS
// the detail fetch" reasoning `TrainerDashboardShell` already established
// for `trainerProfile`. Task 15.4.
describe('ProfilePage (coach)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pre-fills CoachProfileForm from the bootstrap coachProfile', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody()));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/bio/i)).toHaveValue('Loves tennis'));
  });

  it('saves edits via PATCH /coaches/:id and shows a success message', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { ...bootstrapBody().coachProfile, bio: 'Updated bio' }));

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/bio/i)).toHaveValue('Loves tennis'));

    fireEvent.change(screen.getByLabelText(/bio/i), { target: { value: 'Updated bio' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/coaches/coach-1');
    expect(init.method).toBe('PATCH');
  });

  it('shows an error state when the bootstrap request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
