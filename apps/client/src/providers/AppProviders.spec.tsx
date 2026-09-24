import { useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { AppProviders } from './AppProviders';

function QueryClientProbe() {
  const client = useQueryClient();
  return <div data-testid="probe">{client ? 'has-client' : 'no-client'}</div>;
}

describe('AppProviders', () => {
  it('renders its children', () => {
    render(
      <AppProviders>
        <p>child content</p>
      </AppProviders>,
    );

    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('supplies a TanStack Query QueryClient to descendants', () => {
    render(
      <AppProviders>
        <QueryClientProbe />
      </AppProviders>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('has-client');
  });
});
