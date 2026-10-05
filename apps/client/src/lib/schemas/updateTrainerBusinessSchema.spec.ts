import { updateTrainerBusinessSchema } from './updateTrainerBusinessSchema';

const valid = { businessName: 'Acme Tennis', address: '', website: '', description: '' };

describe('updateTrainerBusinessSchema', () => {
  it('accepts a minimal valid payload', () => {
    expect(updateTrainerBusinessSchema.safeParse(valid).success).toBe(true);
  });

  it('requires a business name', () => {
    const result = updateTrainerBusinessSchema.safeParse({ ...valid, businessName: '  ' });
    expect(result.success).toBe(false);
  });

  it('accepts a full https website and rejects non-http(s) or host-less ones', () => {
    expect(updateTrainerBusinessSchema.safeParse({ ...valid, website: 'https://acme.example.com' }).success).toBe(true);
    expect(updateTrainerBusinessSchema.safeParse({ ...valid, website: 'javascript:alert(1)' }).success).toBe(false);
    expect(updateTrainerBusinessSchema.safeParse({ ...valid, website: 'http://localhost' }).success).toBe(false);
    expect(updateTrainerBusinessSchema.safeParse({ ...valid, website: 'acme' }).success).toBe(false);
  });

  it('enforces the length limits', () => {
    expect(updateTrainerBusinessSchema.safeParse({ ...valid, address: 'x'.repeat(501) }).success).toBe(false);
    expect(updateTrainerBusinessSchema.safeParse({ ...valid, description: 'x'.repeat(2001) }).success).toBe(false);
  });
});
