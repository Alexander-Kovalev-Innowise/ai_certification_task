import { isPhotoUrl, MAX_PHOTO_URL_LENGTH } from './asset-url.decorator';

describe('isPhotoUrl (spec US-01.11 "Profile photo (upload or URL)")', () => {
  const saved = { PUBLIC_API_URL: process.env.PUBLIC_API_URL, PORT: process.env.PORT };

  beforeEach(() => {
    process.env.PUBLIC_API_URL = 'http://localhost:3100';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it.each([
    'https://example.com/photo.png',
    'https://images.example.co.uk/a/b/c.jpg?size=512&v=2',
    'http://localhost:3100/uploads/photo-1a2b.webp', // platform asset (plain http on a dev machine)
  ])('accepts %s', (url) => {
    expect(isPhotoUrl(url)).toBe(true);
  });

  it.each([
    ['external http', 'http://example.com/photo.png'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['file:', 'file:///etc/passwd'],
    ['relative path', '/uploads/photo.png'],
    ['not a URL', 'not a url'],
    ['credentials in the URL', 'https://user:pass@example.com/photo.png'],
    ['http on a foreign host posing as an upload', 'http://evil.example.com/uploads/photo.png'],
    ['empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isPhotoUrl(url)).toBe(false);
  });

  it('rejects a non-string and an overly long URL', () => {
    expect(isPhotoUrl(undefined)).toBe(false);
    expect(isPhotoUrl(42)).toBe(false);
    expect(isPhotoUrl(`https://example.com/${'a'.repeat(MAX_PHOTO_URL_LENGTH)}.png`)).toBe(false);
  });
});
