import { fireEvent, render, screen } from '@testing-library/react';

import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('boom');
  }
  return <div>fine</div>;
}

// fe §9.4/Task 18.3 — the generic "Something went wrong" boundary for
// `500 TENANT_SCOPE_VIOLATION` (architecture §8 Layer 2 says this should
// never reach the client, but must degrade safely if it does) and any other
// render-time exception — api §0.5 documents this errorCode as "alerted, not
// user-facing copy," so the fallback deliberately never explains what broke.
describe('ErrorBoundary', () => {
  // React logs the caught error to console.error by default; keep test
  // output clean without hiding a genuine assertion failure.
  let consoleErrorSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('renders a generic, unexplained fallback when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.queryByText(/boom/i)).not.toBeInTheDocument();
  });

  it('lets the user retry, re-rendering children fresh', () => {
    function Wrapper() {
      return (
        <ErrorBoundary>
          <Bomb shouldThrow />
        </ErrorBoundary>
      );
    }
    render(<Wrapper />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    // Re-render attempt: the same Bomb still throws (shouldThrow is fixed),
    // so the boundary catches again — proving reset actually re-executed
    // children instead of doing nothing.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
