import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChildProfileForm } from './ChildProfileForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function futureYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

const TRAINERS = [
  { id: 'trainer-1', businessName: 'Ace Tennis Academy' },
  { id: 'trainer-2', businessName: 'Hoops Club' },
];

// fe §4.6 — ChildProfileForm: create/edit modal (create only, Task 14.3;
// editing basics is ProfileEditForm's job, Task 14.4) — name/dateOfBirth/
// gender/school/photo/trainerIds checklist per FR-031, posts
// `POST /player-profiles`. Task 14.3.
describe('ChildProfileForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<ChildProfileForm isOpen={false} onClose={jest.fn()} onCreated={jest.fn()} availableTrainers={TRAINERS} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows validation errors and does not submit when required fields are empty', async () => {
    render(<ChildProfileForm isOpen onClose={jest.fn()} onCreated={jest.fn()} availableTrainers={TRAINERS} />);

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts CreateChildProfileDto with the trainerIds checklist and calls onCreated + onClose on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { id: 'profile-2', name: 'Alex', dateOfBirth: '2016-01-01', gender: 'MALE', isSelf: false, trainerCount: 1 }),
    );
    const onCreated = jest.fn();
    const onClose = jest.fn();

    render(<ChildProfileForm isOpen onClose={onClose} onCreated={onCreated} availableTrainers={TRAINERS} />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: futureYearsAgo(10) } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'MALE' } });
    fireEvent.click(screen.getByLabelText('Ace Tennis Academy'));
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'profile-2' })));
    expect(onClose).toHaveBeenCalled();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual(expect.objectContaining({ name: 'Alex', gender: 'MALE', trainerIds: ['trainer-1'] }));
  });

  it('surfaces a non-blocking duplicate warning from a 200 response without treating it as an error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, { id: 'profile-3', name: 'Alex', dateOfBirth: '2016-01-01', gender: 'MALE', isSelf: false, warning: 'A profile with this name and age already exists.' }),
    );
    const onCreated = jest.fn();

    render(<ChildProfileForm isOpen onClose={jest.fn()} onCreated={onCreated} availableTrainers={TRAINERS} />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: futureYearsAgo(10) } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'MALE' } });
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ warning: expect.stringContaining('already exists') })));
  });

  it('shows a generic error message on failure without closing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(400, { errorCode: 'VALIDATION_ERROR' }));
    const onClose = jest.fn();

    render(<ChildProfileForm isOpen onClose={onClose} onCreated={jest.fn()} availableTrainers={TRAINERS} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: futureYearsAgo(10) } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'MALE' } });
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<ChildProfileForm isOpen onClose={onClose} onCreated={jest.fn()} availableTrainers={TRAINERS} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
