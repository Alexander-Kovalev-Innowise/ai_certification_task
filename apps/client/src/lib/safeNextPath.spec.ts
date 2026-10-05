import { safeNextPath } from './safeNextPath';

describe('safeNextPath', () => {
  it.each(['/join/abc123', '/dashboard', '/profiles?x=1', '/join/abc#frag'])('accepts the same-origin relative path %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    'https://evil.example.com',
    'http://evil.example.com/join/abc',
    '//evil.example.com',
    '/\\evil.example.com',
    'javascript:alert(1)',
    'join/abc',
    '',
    '/join/ab\nc',
  ])('rejects the unsafe target %j', (path) => {
    expect(safeNextPath(path)).toBeNull();
  });

  it('rejects null/undefined', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});
