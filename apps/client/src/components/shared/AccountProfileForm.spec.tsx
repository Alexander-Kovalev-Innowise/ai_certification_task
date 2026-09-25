import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccountProfileForm, type AccountProfileValues } from './AccountProfileForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function profile(overrides: Partial<AccountProfileValues> = {}): AccountProfileValues {
  return {
    firstName: 'Alex',
    lastName: 'Kovalev',
    phone: null,
    photoUrl: null,
    notificationPrefs: null,
    ...overrides,
  };
}

// fe §7.2/Task 18.1 — AccountProfileForm: `PATCH /me` (api §3), shared by
// every role's `/account/profile` page. `firstName`/`lastName`/`phone` are
// omitted entirely (not rendered-then-rejected) for a CHILD accountType,
// leaving only `photoUrl`/`notificationPrefs` — the same "fewer fields, not
// more validation" pattern `player/ProfileEditForm.tsx` established for
// `allowChildTokenSpendWithoutApproval` (fe §7.2, Task 14.4).
describe('AccountProfileForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pre-fills fields from the given profile for an ADULT account', () => {
    render(<AccountProfileForm profile={profile({ firstName: 'Alex', lastName: 'Kovalev' })} accountType="ADULT" onSaved={jest.fn()} />);

    expect(screen.getByLabelText(/first name/i)).toHaveValue('Alex');
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Kovalev');
  });

  it('omits firstName/lastName/phone fields entirely for a CHILD account', () => {
    render(<AccountProfileForm profile={profile()} accountType="CHILD" onSaved={jest.fn()} />);

    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/last name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^phone/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/photo url/i)).toBeInTheDocument();
  });

  it('submits PATCH /me with edited fields and calls onSaved', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profile({ firstName: 'Alexander' })));
    const onSaved = jest.fn();

    render(<AccountProfileForm profile={profile()} accountType="ADULT" onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Alexander' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Alexander' })));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/me');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual(expect.objectContaining({ firstName: 'Alexander' }));
  });

  it('never sends firstName/lastName/phone in the PATCH body for a CHILD account', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profile()));

    render(<AccountProfileForm profile={profile()} accountType="CHILD" onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('firstName');
    expect(body).not.toHaveProperty('lastName');
    expect(body).not.toHaveProperty('phone');
  });

  it('shows a generic save-error message on a 403 CHILD_FIELD_NOT_EDITABLE response, without crashing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(403, { errorCode: 'CHILD_FIELD_NOT_EDITABLE', details: [{ field: 'firstName', message: 'not editable' }] }),
    );

    render(<AccountProfileForm profile={profile()} accountType="CHILD" onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be saved/i);
  });
});
