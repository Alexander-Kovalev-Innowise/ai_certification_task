import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CoachProfileForm, type CoachProfileDetail } from './CoachProfileForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function profile(overrides: Partial<CoachProfileDetail> = {}): CoachProfileDetail {
  return {
    id: 'coach-1',
    bio: null,
    credentials: null,
    certifications: null,
    publicProfile: false,
    ...overrides,
  };
}

// fe §4.5 — CoachProfileForm: `/profile`'s self-editor, `PATCH /coaches/:id`
// (api §4.2's self-fields branch — bio/credentials/certifications/
// publicProfile, the exact `UpdateCoachDto` subset the COACH actor may send;
// `status` is the owning-TRAINER-only field and never rendered here).
// `publicProfile` is its own standalone optimistic toggle (fe §9.4 names it
// explicitly as a low-stakes/reversible/high-frequency action: immediate UI
// update, PATCH fired separately from the bio/credentials/certifications
// form, rolled back + inline error on failure) — distinct from the batch
// Save button pattern `ProfileEditForm` established for its own fields.
// Task 15.4.
describe('CoachProfileForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pre-fills bio/credentials/certifications from the given profile', () => {
    render(<CoachProfileForm profile={profile({ bio: 'Loves tennis', credentials: 'USPTA', certifications: 'Level 2' })} onSaved={jest.fn()} />);

    expect(screen.getByLabelText(/bio/i)).toHaveValue('Loves tennis');
    expect(screen.getByLabelText(/credentials/i)).toHaveValue('USPTA');
    expect(screen.getByLabelText(/certifications/i)).toHaveValue('Level 2');
  });

  it('reflects the initial publicProfile value on the toggle', () => {
    render(<CoachProfileForm profile={profile({ publicProfile: true })} onSaved={jest.fn()} />);

    expect(screen.getByLabelText(/public profile/i)).toBeChecked();
  });

  it('submits PATCH /coaches/:id with edited bio/credentials/certifications and calls onSaved', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profile({ bio: 'New bio' })));
    const onSaved = jest.fn();

    render(<CoachProfileForm profile={profile()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/bio/i), { target: { value: 'New bio' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ bio: 'New bio' })));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/coaches/coach-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ bio: 'New bio', credentials: undefined, certifications: undefined });
  });

  it('shows a generic error on a failed save without crashing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(400, { errorCode: 'VALIDATION_ERROR' }));

    render(<CoachProfileForm profile={profile()} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be saved/i);
  });

  it('optimistically toggles publicProfile, PATCHes it separately, and calls onSaved', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profile({ publicProfile: true })));
    const onSaved = jest.fn();

    render(<CoachProfileForm profile={profile({ publicProfile: false })} onSaved={onSaved} />);
    const toggle = screen.getByLabelText(/public profile/i);

    fireEvent.click(toggle);

    expect(toggle).toBeChecked();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ publicProfile: true })));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/coaches/coach-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ publicProfile: true });
  });

  it('rolls back the publicProfile toggle and shows an inline error when the PATCH fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    render(<CoachProfileForm profile={profile({ publicProfile: false })} onSaved={jest.fn()} />);
    const toggle = screen.getByLabelText(/public profile/i);

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be saved/i);
  });
});
