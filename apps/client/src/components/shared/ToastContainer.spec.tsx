import { act, fireEvent, render, screen } from '@testing-library/react';

import { useToastStore } from '../../stores/useToastStore';

import { ToastContainer } from './ToastContainer';

// Task 18.3 — `ToastContainer`: the sole reader of `useToastStore`, mounted
// once at the root boundary (alongside ImpersonationBanner/
// EmailVerifiedBanner). `error` variant toasts are `role="alert"` (assertive
// — the same semantics every existing inline error message in this app
// uses); `success`/`info` are `role="status"` (polite).
describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders nothing when there are no toasts', () => {
    render(<ToastContainer />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a success/info toast as role="status" and an error toast as role="alert"', () => {
    render(<ToastContainer />);

    act(() => {
      useToastStore.getState().push('success', 'Saved.');
      useToastStore.getState().push('error', 'Something broke.');
    });

    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke.');
  });

  it('dismisses a toast on its own close button click', () => {
    render(<ToastContainer />);

    act(() => {
      useToastStore.getState().push('info', 'Dismiss me');
    });
    expect(screen.getByText('Dismiss me')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
  });
});
