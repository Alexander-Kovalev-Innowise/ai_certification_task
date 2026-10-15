import { fireEvent, render, screen } from '@testing-library/react';

import { CoachAcceptForm } from './CoachAcceptForm';

describe('CoachAcceptForm', () => {
  it('renders no password field — already authenticated', () => {
    render(<CoachAcceptForm trainerDisplayName="Coach Lisa" onSubmit={jest.fn()} />);

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText('Accept this invitation to coach for Coach Lisa?')).toBeInTheDocument();
  });

  it('calls onSubmit with no arguments when confirmed', () => {
    const onSubmit = jest.fn();
    render(<CoachAcceptForm trainerDisplayName="Coach Lisa" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('disables the button while submitting and shows a submitError', () => {
    render(<CoachAcceptForm trainerDisplayName="Coach Lisa" onSubmit={jest.fn()} isSubmitting submitError="Something went wrong." />);

    expect(screen.getByRole('button', { name: /joining/i })).toBeDisabled();
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});
