import { loginSchema } from './loginSchema';

describe('loginSchema', () => {
  it('accepts a valid email/password pair', () => {
    const result = loginSchema.safeParse({ email: 'trainer@example.com', password: 'anything' });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'anything' });

    expect(result.success).toBe(false);
  });

  it('rejects an empty password (no strength check, just non-empty)', () => {
    const result = loginSchema.safeParse({ email: 'trainer@example.com', password: '' });

    expect(result.success).toBe(false);
  });

  it('rejects an email over 255 characters', () => {
    const longEmail = `${'a'.repeat(250)}@ex.com`;
    const result = loginSchema.safeParse({ email: longEmail, password: 'anything' });

    expect(result.success).toBe(false);
  });
});
