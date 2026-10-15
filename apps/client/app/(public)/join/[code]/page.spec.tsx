import { render, screen } from '@testing-library/react';

import JoinPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('JoinPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { valid: false, reason: 'NOT_FOUND' }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the dynamic [code] param and passes it down to ShareLinkDispatcher', async () => {
    const element = await JoinPage({ params: Promise.resolve({ code: 'my-code-1' }) });
    render(element);

    expect(await screen.findByText("This invitation link doesn't exist.")).toBeInTheDocument();
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/share-links/my-code-1');
  });

  it('reads ?camp=<token> and fetches the camp prefill', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) =>
      url.includes('/camp-conversions/')
        ? mockResponse(404, { errorCode: 'NOT_FOUND' })
        : mockResponse(200, { valid: true, type: 'PLAYER_STATIC', trainerDisplayName: 'Coach Lisa', logoUrl: null, primaryColorHex: null }),
    );

    const element = await JoinPage({ params: Promise.resolve({ code: 'my-code-1' }), searchParams: Promise.resolve({ camp: 'tok-9' }) });
    render(element);

    expect(await screen.findByText(/camp sign-up link/i)).toBeInTheDocument();
    expect((global.fetch as jest.Mock).mock.calls.some(([url]) => (url as string).includes('/camp-conversions/tok-9'))).toBe(true);
  });
});
