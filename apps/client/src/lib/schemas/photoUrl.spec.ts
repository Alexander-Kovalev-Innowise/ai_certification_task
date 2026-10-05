import { buildAccountProfileSchema } from './accountProfileSchema';
import { isHttpsImageUrl, isValidPhotoUrl, MAX_PHOTO_URL_LENGTH } from './photoUrl';
import { updatePlayerProfileSchema } from './updatePlayerProfileSchema';

// Spec US-01.11 "Profile photo (upload or URL)" - client mirror of the server's isPhotoUrl.
describe('photo URL validation', () => {
  it.each(['https://images.example.com/me.jpg', 'https://cdn.example.org/a/b.png?w=256', 'http://localhost:3100/uploads/photo-1a2b.webp'])(
    'isValidPhotoUrl accepts %s',
    (url) => {
      expect(isValidPhotoUrl(url)).toBe(true);
    },
  );

  it.each([
    'http://images.example.com/me.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://example.com/me.jpg',
    'not a url',
    'https://user:pw@example.com/me.jpg',
    `https://example.com/${'a'.repeat(MAX_PHOTO_URL_LENGTH)}.jpg`,
  ])('isValidPhotoUrl rejects %s', (url) => {
    expect(isValidPhotoUrl(url)).toBe(false);
  });

  it('a typed-in link must be https - even an /uploads/ path on http is not accepted', () => {
    expect(isHttpsImageUrl('https://images.example.com/me.jpg')).toBe(true);
    expect(isHttpsImageUrl('http://localhost:3100/uploads/photo-1.webp')).toBe(false);
  });

  it('the account and player-profile forms accept an https photo URL and reject an http one', () => {
    const player = {
      name: 'Alex',
      school: '',
      jerseyNumber: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      allowChildTokenSpendWithoutApproval: false,
    };
    expect(updatePlayerProfileSchema.safeParse({ ...player, photoUrl: 'https://images.example.com/a.jpg' }).success).toBe(true);
    expect(updatePlayerProfileSchema.safeParse({ ...player, photoUrl: '' }).success).toBe(true);
    expect(updatePlayerProfileSchema.safeParse({ ...player, photoUrl: 'http://images.example.com/a.jpg' }).success).toBe(false);

    const account = { firstName: 'Al', lastName: 'Ex', phone: '', emailNotifications: true, smsNotifications: false };
    const schema = buildAccountProfileSchema(false);
    expect(schema.safeParse({ ...account, photoUrl: 'https://images.example.com/a.jpg' }).success).toBe(true);
    expect(schema.safeParse({ ...account, photoUrl: 'http://images.example.com/a.jpg' }).success).toBe(false);
  });
});
