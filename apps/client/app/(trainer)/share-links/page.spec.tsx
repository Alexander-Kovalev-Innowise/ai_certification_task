import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import ShareLinksPage from './page';

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

function bootstrapBody() {
  return {
    role: 'TRAINER',
    user: trainerUser,
    trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis' },
    branding: { logoUrl: null, primaryColorHex: null },
    coachCount: 1,
    activePlayerCount: 3,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShareLinksPage />
    </QueryClientProvider>,
  );
}

// fe §4.4 — `/share-links`: GET /trainers/:id/share-links + generator modal
// (POST /share-links) + optimistic revoke (DELETE /share-links/:id). Task
// 13.3. Wrapped by `(trainer)/layout.tsx`'s RoleGuard(TRAINER).
describe('ShareLinksPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 't', user: trainerUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads bootstrap for the own trainerId, then GET /trainers/:id/share-links, and renders the list', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, {
          items: [{ id: 'link-1', code: 'abc123', type: 'PLAYER_STATIC', targetEmail: null, status: 'ACTIVE', useCount: 0, expiresAt: null, createdAt: '2026-01-01T00:00:00.000Z' }],
          nextCursor: null,
          hasMore: false,
        }),
      );

    renderPage();

    await waitFor(() => expect(screen.getByRole('row', { name: /abc123/i })).toBeInTheDocument());

    const [listUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(listUrl).toContain('/trainers/trainer-1/share-links');
  });

  it('opens GenerateShareLinkModal from the "Generate Link" button and refetches on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(201, { id: 'link-1', code: 'abc123', type: 'PLAYER_STATIC', joinUrl: '/join/abc123', expiresAt: null, status: 'ACTIVE' }))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /generate link/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
  });

  it('optimistically fades a revoked row immediately, then removes it once the server confirms', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, {
          items: [{ id: 'link-1', code: 'abc123', type: 'PLAYER_STATIC', targetEmail: null, status: 'ACTIVE', useCount: 0, expiresAt: null, createdAt: '2026-01-01T00:00:00.000Z' }],
          nextCursor: null,
          hasMore: false,
        }),
      )
      .mockResolvedValueOnce(mockResponse(204))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /abc123/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, revoke/i }));

    expect(screen.getByRole('row', { name: /abc123/i })).toHaveClass('opacity-40');

    await waitFor(() => expect(screen.queryByRole('row', { name: /abc123/i })).not.toBeInTheDocument());
  });

  it('rolls back the fade when the revoke request fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, {
          items: [{ id: 'link-1', code: 'abc123', type: 'PLAYER_STATIC', targetEmail: null, status: 'ACTIVE', useCount: 0, expiresAt: null, createdAt: '2026-01-01T00:00:00.000Z' }],
          nextCursor: null,
          hasMore: false,
        }),
      )
      .mockResolvedValueOnce(mockResponse(500));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /abc123/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, revoke/i }));

    expect(screen.getByRole('row', { name: /abc123/i })).toHaveClass('opacity-40');

    await waitFor(() => expect(screen.getByRole('row', { name: /abc123/i })).not.toHaveClass('opacity-40'));
    expect(screen.getByRole('row', { name: /abc123/i })).toBeInTheDocument();
  });
});
