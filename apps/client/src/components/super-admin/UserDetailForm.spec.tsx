import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { UserDetailResponseDto } from './UserDetailForm';
import { UserDetailForm } from './UserDetailForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function baseUser(): UserDetailResponseDto {
  return {
    id: 'u1',
    email: 'ada@example.com',
    role: 'TRAINER',
    accountType: 'ADULT',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+14155552671',
    photoUrl: null,
    emailVerified: true,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    lastLoginAt: null,
    deletedAt: null,
  };
}

// fe §4.3 — UserDetailForm: PATCH /users/:id (api §3), a superset of
// UpdateMeDto — role is deliberately excluded (BR-001). Task 12.5.
describe('UserDetailForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the read-only email, role, and status alongside editable fields', () => {
    render(<UserDetailForm user={baseUser()} />);

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('TRAINER')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Lovelace');
  });

  it('submits PATCH /users/:id with the edited name/phone fields and calls onSaved', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...baseUser(), firstName: 'Grace' }));
    const onSaved = jest.fn();

    render(<UserDetailForm user={baseUser()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/users/u1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ firstName: 'Grace', lastName: 'Lovelace', phone: '+14155552671' });
  });

  it('shows a validation error and does not submit when first name is cleared', async () => {
    render(<UserDetailForm user={baseUser()} />);

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows an error message when the save fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    render(<UserDetailForm user={baseUser()} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/something went wrong saving/i)).toBeInTheDocument();
  });
});
