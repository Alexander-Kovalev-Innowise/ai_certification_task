import { render, screen, waitFor } from '@testing-library/react';

import { ShareLinkDispatcher } from './ShareLinkDispatcher';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('ShareLinkDispatcher', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /share-links/:code on mount', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { valid: false, reason: 'NOT_FOUND' }));

    render(<ShareLinkDispatcher code="abc123" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/share-links/abc123');
  });

  it.each([
    ['NOT_FOUND', "This invitation link doesn't exist."],
    ['EXPIRED', 'This invitation link has expired. Ask your trainer for a new one.'],
    ['EXHAUSTED', 'This invitation link has already been used.'],
    ['REVOKED', 'This invitation link is no longer active.'],
  ] as const)('renders the distinct copy for reason=%s', async (reason, expectedCopy) => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { valid: false, reason }));

    render(<ShareLinkDispatcher code="abc123" />);

    expect(await screen.findByText(expectedCopy)).toBeInTheDocument();
  });

  it('renders ShareLinkPreview when valid: true', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        valid: true,
        type: 'PLAYER_STATIC',
        trainerDisplayName: 'Coach Lisa',
        logoUrl: null,
        primaryColorHex: null,
      }),
    );

    render(<ShareLinkDispatcher code="abc123" />);

    expect(await screen.findByText('Join Coach Lisa')).toBeInTheDocument();
  });

  it('treats a network-level failure as data (renders the invalid card) instead of throwing', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));

    render(<ShareLinkDispatcher code="abc123" />);

    expect(await screen.findByText('Something went wrong loading this invitation link. Please try again.')).toBeInTheDocument();
  });

  it('treats a non-ok HTTP response as data too (never throws)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500, {}));

    render(<ShareLinkDispatcher code="abc123" />);

    expect(await screen.findByText('Something went wrong loading this invitation link. Please try again.')).toBeInTheDocument();
  });
});
