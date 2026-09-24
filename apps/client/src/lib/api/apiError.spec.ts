import { parseApiErrorBody, readRetryAfterSeconds } from './apiError';

function mockErrorResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return {
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

describe('parseApiErrorBody', () => {
  it('returns the parsed body when it carries an errorCode', async () => {
    const res = mockErrorResponse({ statusCode: 401, errorCode: 'ACCOUNT_INACTIVE', message: 'nope', error: 'Unauthorized', path: '/auth/login', requestId: 'r-1' });

    const parsed = await parseApiErrorBody(res);

    expect(parsed?.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  it('returns null when the body has no errorCode field', async () => {
    const res = mockErrorResponse({ message: 'plain error' });

    expect(await parseApiErrorBody(res)).toBeNull();
  });

  it('returns null instead of throwing when the body is not valid JSON', async () => {
    const res = { json: async () => { throw new Error('not json'); } } as unknown as Response;

    expect(await parseApiErrorBody(res)).toBeNull();
  });
});

describe('readRetryAfterSeconds', () => {
  it('parses the Retry-After header as seconds', () => {
    expect(readRetryAfterSeconds(mockErrorResponse({}, { 'Retry-After': '30' }))).toBe(30);
  });

  it('returns null when the header is absent', () => {
    expect(readRetryAfterSeconds(mockErrorResponse({}))).toBeNull();
  });
});
