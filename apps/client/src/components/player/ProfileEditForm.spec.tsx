import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ProfileEditForm, type PlayerProfileDetail } from './ProfileEditForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function profile(overrides: Partial<PlayerProfileDetail> = {}): PlayerProfileDetail {
  return {
    id: 'profile-2',
    name: 'Alex',
    school: null,
    jerseyNumber: null,
    photoUrl: null,
    emergencyContact: null,
    allowChildTokenSpendWithoutApproval: false,
    isSelf: false,
    ...overrides,
  };
}

// fe §4.6/§7.2 — ProfileEditForm: `PATCH /player-profiles/:id` (api §4.3).
// `allowChildTokenSpendWithoutApproval` is rendered only when the caller is
// the owning ADULT (never for a CHILD's own view, even of their own
// profile — it's a parental control, FR-041/api §4.3's
// CHILD_FIELD_NOT_EDITABLE pattern). Task 14.4.
describe('ProfileEditForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pre-fills fields from the given profile', () => {
    render(<ProfileEditForm profile={profile({ name: 'Alex', school: 'Lincoln Elementary' })} canEditGuardianFields onSaved={jest.fn()} />);

    expect(screen.getByLabelText(/^name/i)).toHaveValue('Alex');
    expect(screen.getByLabelText(/school/i)).toHaveValue('Lincoln Elementary');
  });

  it('shows allowChildTokenSpendWithoutApproval only when canEditGuardianFields is true', () => {
    const { rerender } = render(<ProfileEditForm profile={profile()} canEditGuardianFields onSaved={jest.fn()} />);
    expect(screen.getByLabelText(/spend.*without approval/i)).toBeInTheDocument();

    rerender(<ProfileEditForm profile={profile()} canEditGuardianFields={false} onSaved={jest.fn()} />);
    expect(screen.queryByLabelText(/spend.*without approval/i)).not.toBeInTheDocument();
  });

  it('submits PATCH /player-profiles/:id with edited fields and calls onSaved', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profile({ name: 'Alexander' })));
    const onSaved = jest.fn();

    render(<ProfileEditForm profile={profile()} canEditGuardianFields onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Alexander' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alexander' })));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles/profile-2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual(expect.objectContaining({ name: 'Alexander' }));
  });

  it('shows a field-level toast on 403 CHILD_FIELD_NOT_EDITABLE without crashing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(403, { errorCode: 'CHILD_FIELD_NOT_EDITABLE', details: [{ field: 'allowChildTokenSpendWithoutApproval', message: 'not editable' }] }),
    );

    render(<ProfileEditForm profile={profile()} canEditGuardianFields={false} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be saved/i);
  });
});
