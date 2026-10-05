import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AnonymousJoinForm } from './AnonymousJoinForm';

describe('AnonymousJoinForm', () => {
  describe('type: COACH_UNIQUE', () => {
    it('renders first/last name and a password field — no email/player fields', () => {
      render(<AnonymousJoinForm type="COACH_UNIQUE" onSubmit={jest.fn()} />);

      expect(screen.getByLabelText('First name')).toBeInTheDocument();
      expect(screen.getByLabelText('Last name')).toBeInTheDocument();
      expect(screen.getByLabelText('Choose a password')).toBeInTheDocument();
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Player's name")).not.toBeInTheDocument();
    });

    it('builds a { firstName, lastName, password } body on submit — no email field', async () => {
      const onSubmit = jest.fn();
      render(<AnonymousJoinForm type="COACH_UNIQUE" onSubmit={onSubmit} />);

      fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Casey' } });
      fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Coach' } });
      fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'Password1' } });
      fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ firstName: 'Casey', lastName: 'Coach', password: 'Password1' }));
    });

    it('does not submit without a first and last name', async () => {
      const onSubmit = jest.fn();
      render(<AnonymousJoinForm type="COACH_UNIQUE" onSubmit={onSubmit} />);

      fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'Password1' } });
      fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

      await waitFor(() => expect(screen.getAllByText(/is required/i).length).toBeGreaterThan(0));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renders an "Already have an account? Sign in" link to the supplied href', () => {
      render(<AnonymousJoinForm type="COACH_UNIQUE" onSubmit={jest.fn()} signInHref="/login?next=/join/abc" />);

      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=/join/abc');
    });
  });

  describe('type: PLAYER_STATIC', () => {
    function fillCommonFields() {
      fireEvent.change(screen.getByLabelText('Your first name'), { target: { value: 'Pat' } });
      fireEvent.change(screen.getByLabelText('Your last name'), { target: { value: 'Parent' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'parent@example.com' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
      fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+14155552671' } });
      fireEvent.change(screen.getByLabelText("Player's name"), { target: { value: 'Alex' } });
      fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-01-01' } });
      fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'MALE' } });
    }

    it('renders the full registration field set', () => {
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={jest.fn()} />);

      expect(screen.getByLabelText('Your first name')).toBeInTheDocument();
      expect(screen.getByLabelText('Your last name')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
      expect(screen.getByLabelText("Player's name")).toBeInTheDocument();
      expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
      expect(screen.getByLabelText('Gender')).toBeInTheDocument();
      expect(screen.getByLabelText('Who is this registration for?')).toBeInTheDocument();
      expect(screen.getByText('Me')).toBeInTheDocument();
      expect(screen.getByText('My child')).toBeInTheDocument();
    });

    it('defaults isSelf to true ("Me") and builds the ANONYMOUS_REGISTRATION body on submit', async () => {
      const onSubmit = jest.fn();
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={onSubmit} />);

      fillCommonFields();
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith({
          parentFirstName: 'Pat',
          parentLastName: 'Parent',
          email: 'parent@example.com',
          password: 'Password1',
          phone: '+14155552671',
          playerName: 'Alex',
          dateOfBirth: '1990-01-01',
          gender: 'MALE',
          isSelf: true,
        }),
      );
    });

    it('builds isSelf: false when "My child" is selected', async () => {
      const onSubmit = jest.fn();
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={onSubmit} />);

      fillCommonFields();
      fireEvent.change(screen.getByLabelText('Who is this registration for?'), { target: { value: 'false' } });
      fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2015-01-01' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ isSelf: false })));
    });

    it('rejects a minor registering as "Me": players under 18 are parent-managed', async () => {
      const onSubmit = jest.fn();
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={onSubmit} />);

      fillCommonFields();
      fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2015-01-01' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText('Players under 18 must be registered by a parent - choose "My child".')).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renders an "Already have an account? Sign in" link to the supplied href', () => {
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={jest.fn()} signInHref="/login?next=/join/abc" />);

      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=/join/abc');
    });

    it('does not submit when a required field is missing', async () => {
      const onSubmit = jest.fn();
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={onSubmit} />);

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(screen.getByText('Email is required.')).toBeInTheDocument());
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('shows a submitError passed from the parent', () => {
      render(<AnonymousJoinForm type="PLAYER_STATIC" onSubmit={jest.fn()} submitError="Something went wrong." />);

      expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    });
  });
});
