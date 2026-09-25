import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { FatalApiError } from '../lib/api/apiClient';

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
