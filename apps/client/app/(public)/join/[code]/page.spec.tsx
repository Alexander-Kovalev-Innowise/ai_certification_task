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
});
