import { useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';

import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { FatalApiError } from '../lib/api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';

import { QueryProvider } from './QueryProvider';

function FatalQueryProbe() {
  const { isLoading } = useQuery({
    queryKey: ['fatal-probe'],
    queryFn: () => {
      throw new FatalApiError('TENANT_SCOPE_VIOLATION');
    },
    retry: false,
  });
  return <div>{isLoading ? 'loading' : 'loaded'}</div>;
}

function OrdinaryErrorQueryProbe() {
  const { isError } = useQuery({
    queryKey: ['ordinary-probe'],
    queryFn: () => {
      throw new Error('just a normal fetch failure');
    },
    retry: false,
  });
  return <div>{isError ? 'query reported its own error' : 'ok'}</div>;
}

// fe §9.4/Task 18.3 — proves the actual wiring end-to-end: a query throwing
// `FatalApiError` (apiRequest()'s reaction to `500 TENANT_SCOPE_VIOLATION`)
// propagates through TanStack Query's `throwOnError` predicate
// (QueryProvider.tsx) to the nearest `ErrorBoundary`, while an ordinary
// query error does NOT — it stays in the query's own `isError` state, the
// established per-page handling every other query-backed route already
// uses (dashboard/page.tsx, (coach)/profile/page.tsx, etc.).
describe('QueryProvider throwOnError wiring', () => {
  let consoleErrorSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('propagates a FatalApiError to the root ErrorBoundary', async () => {
    render(
      <QueryProvider>
        <ErrorBoundary>
          <FatalQueryProbe />
        </ErrorBoundary>
      </QueryProvider>,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i));
  });

  it('does not propagate an ordinary query error to the boundary', async () => {
    render(
      <QueryProvider>
        <ErrorBoundary>
          <OrdinaryErrorQueryProbe />
        </ErrorBoundary>
      </QueryProvider>,
    );

    await waitFor(() => expect(screen.getByText('query reported its own error')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

function sessionFor(id: string, isImpersonating = false) {
  return {
    accessToken: `token-${id}`,
    expiresAt: Date.now() + 60_000,
    csrfToken: '',
    isImpersonating,
    user: { id, email: `${id}@example.com`, role: 'TRAINER' as const, accountType: 'ADULT' as const, firstName: id, lastName: 'User', mustChangePassword: false },
  };
}

// A different identity (sign out -> sign in as someone else, or entering/leaving
// impersonation) must never be served the previous identity's cached server state.
describe('QueryProvider identity change', () => {
  function IdentityProbe({ onFetch }: { onFetch: () => string }) {
    const { data } = useQuery({ queryKey: ['me', 'bootstrap'], queryFn: async () => onFetch() });
    return <div>{data ?? 'loading'}</div>;
  }

  afterEach(() => act(() => useAuthStore.getState().clear()));

  it('drops cached queries and refetches when the signed-in user changes', async () => {
    let calls = 0;
    const onFetch = () => `payload-${++calls}`;
    act(() => useAuthStore.getState().setSession(sessionFor('admin')));

    render(
      <QueryProvider>
        <IdentityProbe onFetch={onFetch} />
      </QueryProvider>,
    );
    expect(await screen.findByText('payload-1')).toBeInTheDocument();

    act(() => useAuthStore.getState().setSession(sessionFor('trainer', true)));

    expect(await screen.findByText('payload-2')).toBeInTheDocument();
  });

  it('keeps the cache when only the token is refreshed for the same identity', async () => {
    let calls = 0;
    const onFetch = () => `payload-${++calls}`;
    act(() => useAuthStore.getState().setSession(sessionFor('admin')));

    render(
      <QueryProvider>
        <IdentityProbe onFetch={onFetch} />
      </QueryProvider>,
    );
    expect(await screen.findByText('payload-1')).toBeInTheDocument();

    act(() => useAuthStore.getState().setSession({ ...sessionFor('admin'), accessToken: 'refreshed' }));

    await waitFor(() => expect(screen.getByText('payload-1')).toBeInTheDocument());
    expect(calls).toBe(1);
  });
});
