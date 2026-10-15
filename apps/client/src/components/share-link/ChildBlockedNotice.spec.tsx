import { render, screen, waitFor } from '@testing-library/react';

import { ChildBlockedNotice } from './ChildBlockedNotice';

function mockResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), headers: new Headers() } as unknown as Response;
}

describe('ChildBlockedNotice', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(403));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the mandated copy', () => {
    render(<ChildBlockedNotice code="notice-copy" />);

    expect(screen.getByText('Ask your parent to register you with this trainer.')).toBeInTheDocument();
  });

  it('calls POST /share-links/:code/redeem on mount so the server emails the guardian', async () => {
    render(<ChildBlockedNotice code="notice-mount" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/share-links/notice-mount/redeem');
    expect(options.method).toBe('POST');
  });

  it('does not call redeem again on re-render or remount for the same code (de-duplicated)', async () => {
    const { rerender, unmount } = render(<ChildBlockedNotice code="notice-dedupe" />);
    rerender(<ChildBlockedNotice code="notice-dedupe" />);
    unmount();
    render(<ChildBlockedNotice code="notice-dedupe" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it('swallows a failed redeem call (the child still sees the message)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));

    render(<ChildBlockedNotice code="notice-fail" />);

    expect(screen.getByText('Ask your parent to register you with this trainer.')).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });
});
