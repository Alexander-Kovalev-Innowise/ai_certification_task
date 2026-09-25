import { updateBrandingSchema } from './updateBrandingSchema';

// api §4.1's `UpdateBrandingDto` mirror — `primaryColorHex` must match the
// server's `@Matches(/^#[0-9A-Fa-f]{6}$/)` exactly; `logoUrl` is a valid URL
// when present (pre-uploaded via `POST /storage/logo`, never user-typed).
// Task 17.1.
describe('updateBrandingSchema', () => {
  it('accepts a valid 6-digit hex color with no logoUrl', () => {
    const result = updateBrandingSchema.safeParse({ primaryColorHex: '#6EE7B7' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid hex color plus a valid logoUrl', () => {
    const result = updateBrandingSchema.safeParse({
      primaryColorHex: '#000000',
      logoUrl: 'https://cdn.example.com/logo-123.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a hex color missing the leading #', () => {
    const result = updateBrandingSchema.safeParse({ primaryColorHex: '6EE7B7' });
    expect(result.success).toBe(false);
  });

  it('rejects a 3-digit shorthand hex color', () => {
    const result = updateBrandingSchema.safeParse({ primaryColorHex: '#6E7' });
    expect(result.success).toBe(false);
  });

  it('rejects a hex color with invalid characters', () => {
    const result = updateBrandingSchema.safeParse({ primaryColorHex: '#GGGGGG' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL logoUrl', () => {
    const result = updateBrandingSchema.safeParse({ primaryColorHex: '#6EE7B7', logoUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('accepts an empty-string logoUrl (no logo set yet)', () => {
    const result = updateBrandingSchema.safeParse({ primaryColorHex: '#6EE7B7', logoUrl: '' });
    expect(result.success).toBe(true);
  });
});
