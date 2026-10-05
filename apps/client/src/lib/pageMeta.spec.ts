import { faviconHref, formatDocumentTitle, resolvePageMeta } from './pageMeta';

describe('resolvePageMeta', () => {
  it('resolves static routes', () => {
    expect(resolvePageMeta('/users')).toEqual({ title: 'Users', icon: 'users' });
    expect(resolvePageMeta('/login')).toEqual({ title: 'Sign in', icon: 'log-in' });
  });

  it('matches [param] segments and prefers the more specific route', () => {
    expect(resolvePageMeta('/users/abc-123').title).toBe('Edit user');
    expect(resolvePageMeta('/profiles/p1/availability').title).toBe('Availability');
    expect(resolvePageMeta('/profiles/p1').title).toBe('Player profile');
    expect(resolvePageMeta('/join/XYZ').title).toBe('Join a trainer');
  });

  it('ignores a trailing slash and falls back to the app name for unknown routes', () => {
    expect(resolvePageMeta('/coaches/').title).toBe('Coaches');
    expect(resolvePageMeta('/nope/nothing').title).toBe('PracticePerfect');
  });
});

describe('formatDocumentTitle / faviconHref', () => {
  it('suffixes page titles with the app name but leaves the bare app name alone', () => {
    expect(formatDocumentTitle('Users')).toBe('Users | PracticePerfect');
    expect(formatDocumentTitle('PracticePerfect')).toBe('PracticePerfect');
  });

  it('builds an SVG data-URI icon in the accent colour', () => {
    const href = faviconHref('users');
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(href)).toContain('#00B300');
  });
});
