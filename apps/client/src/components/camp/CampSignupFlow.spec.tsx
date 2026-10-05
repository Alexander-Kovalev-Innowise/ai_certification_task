import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CampSignupFlow } from './CampSignupFlow';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}

const validPreview = { valid: true, type: 'PLAYER_STATIC', trainerDisplayName: 'Coach Lisa', logoUrl: null, primaryColorHex: null };

function fillForm() {
  fireEvent.change(screen.getByLabelText('Your first name'), { target: { value: 'Pat' } });
  fireEvent.change(screen.getByLabelText('Your last name'), { target: { value: 'Camper' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@example.com' } });
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+14155552671' } });
  fireEvent.change(screen.getByLabelText("Player's name"), { target: { value: 'Kid Camper' } });
  fireEvent.change(screen.getByLabelText("Player's age"), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'FEMALE' } });
}

describe('CampSignupFlow', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the invalid card for an unusable ShareLink', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { valid: false, reason: 'REVOKED' }));

    render(<CampSignupFlow code="abc" />);

    expect(await screen.findByText('This invitation link is no longer active.')).toBeInTheDocument();
  });

  it('a COACH_UNIQUE code is not a camp link', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...validPreview, type: 'COACH_UNIQUE' }));

    render(<CampSignupFlow code="abc" />);

    expect(await screen.findByText("This invitation link doesn't exist.")).toBeInTheDocument();
  });

  it('validates the age before posting', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview));
    render(<CampSignupFlow code="abc" />);
    await screen.findByLabelText('Email');

    fireEvent.change(screen.getByLabelText("Player's age"), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /submit sign-up/i }));

    expect(await screen.findByText('Enter an age between 1 and 99.')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('posts to /camp-conversions and then offers "Create account now" to the pre-filled join page', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, validPreview))
      .mockResolvedValueOnce(mockResponse(201, { conversionToken: 'tok1', expiresAt: '2030-01-01T00:00:00Z', joinUrl: '/join/abc?camp=tok1' }));

    render(<CampSignupFlow code="abc" />);
    await screen.findByLabelText('Email');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /submit sign-up/i }));

    const link = await screen.findByRole('link', { name: 'Create account now' });
    expect(link).toHaveAttribute('href', '/join/abc?camp=tok1');
    expect(screen.getByText(/Create your PracticePerfect account to see schedules/)).toBeInTheDocument();

    const [url, options] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toContain('/camp-conversions');
    expect(JSON.parse(options.body)).toEqual({
      shareLinkCode: 'abc',
      parentFirstName: 'Pat',
      parentLastName: 'Camper',
      email: 'pat@example.com',
      phone: '+14155552671',
      playerName: 'Kid Camper',
      playerAge: 10,
      playerGender: 'FEMALE',
      source: 'CAMP',
    });
  });

  it('"Email me the link for later" calls email-link and confirms', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, validPreview))
      .mockResolvedValueOnce(mockResponse(201, { conversionToken: 'tok1', expiresAt: '2030-01-01T00:00:00Z', joinUrl: '/join/abc?camp=tok1' }))
      .mockResolvedValueOnce(mockResponse(202, { queued: true }));

    render(<CampSignupFlow code="abc" />);
    await screen.findByLabelText('Email');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /submit sign-up/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Email me the link for later' }));

    expect(await screen.findByText(/We emailed the link to pat@example.com/)).toBeInTheDocument();
    const [url, options] = (global.fetch as jest.Mock).mock.calls[2];
    expect(url).toContain('/camp-conversions/tok1/email-link');
    expect(options.method).toBe('POST');
  });

  it('shows the server message when the submission is rejected', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, validPreview))
      .mockResolvedValueOnce(mockResponse(409, { errorCode: 'SHARE_LINK_UNAVAILABLE', message: 'This ShareLink is no longer available' }));

    render(<CampSignupFlow code="abc" />);
    await screen.findByLabelText('Email');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /submit sign-up/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This ShareLink is no longer available'));
  });
});
