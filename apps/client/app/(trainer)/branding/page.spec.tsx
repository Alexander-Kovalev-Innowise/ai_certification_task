import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import BrandingPage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const trainerUser: UserSummaryDto = {
  id: 'user-1',
  email: 'trainer@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Tia',
  lastName: 'Trainer',
  mustChangePassword: false,
};

function bootstrapBody(branding: { logoUrl: string | null; primaryColorHex: string | null }) {
  return {
    role: 'TRAINER',
    user: trainerUser,
    trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis' },
    branding,
    coachCount: 1,
    activePlayerCount: 3,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrandingPage />
    </QueryClientProvider>,
  );
}

// fe §8 — `/branding`: reads the TRAINER bootstrap's `branding` block to
// prefill ColorPicker/LogoUploadField, saves via `PATCH
// /trainers/:id/branding` (api §4.1, FR-071). Task 17.1. Wrapped by
// `(trainer)/layout.tsx`'s RoleGuard(TRAINER), so this leaf doesn't re-guard.
describe('BrandingPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 't', user: trainerUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefills the color picker from the bootstrap branding block', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: '#123ABC' })));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/hex/i)).toHaveValue('#123ABC'));
  });

  it('falls back to the platform default color when the trainer has no saved branding yet', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: null })));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/hex/i)).toHaveValue('#6EE7B7'));
  });

  it('saves the branding via PATCH /trainers/:id/branding and shows a success message', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: '#123ABC' })))
      .mockResolvedValueOnce(mockResponse(200, { logoUrl: null, primaryColorHex: '#000000', derivedPalette: null }))
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: '#000000' })));

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/hex/i)).toHaveValue('#123ABC'));

    fireEvent.change(screen.getByLabelText(/hex/i), { target: { value: '#000000' } });
    fireEvent.click(screen.getByRole('button', { name: /save branding/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/branding saved/i));

    const [patchUrl, patchOptions] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(patchUrl).toContain('/trainers/trainer-1/branding');
    expect(patchOptions.method).toBe('PATCH');
    expect(JSON.parse(patchOptions.body as string)).toEqual({ primaryColorHex: '#000000' });
  });

  it('renders a dismissible ContrastWarningBanner when the PATCH response carries contrastWarning, after the save already succeeded', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: '#123ABC' })))
      .mockResolvedValueOnce(
        mockResponse(200, {
          logoUrl: null,
          primaryColorHex: '#FFFFFF',
          derivedPalette: null,
          contrastWarning: 'This color may be hard to read for some users — consider a darker shade.',
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: '#FFFFFF' })));

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/hex/i)).toHaveValue('#123ABC'));

    fireEvent.change(screen.getByLabelText(/hex/i), { target: { value: '#FFFFFF' } });
    fireEvent.click(screen.getByRole('button', { name: /save branding/i }));

    await waitFor(() => expect(screen.getByText(/hard to read/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/hard to read/i)).not.toBeInTheDocument();
  });

  it('shows a generic error message when the save fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody({ logoUrl: null, primaryColorHex: '#123ABC' })))
      .mockResolvedValueOnce(mockResponse(500, { errorCode: 'INTERNAL', message: 'boom' }));

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/hex/i)).toHaveValue('#123ABC'));

    fireEvent.click(screen.getByRole('button', { name: /save branding/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong saving your branding/i));
  });
});
