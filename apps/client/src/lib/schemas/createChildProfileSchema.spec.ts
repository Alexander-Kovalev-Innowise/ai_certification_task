import { createChildProfileSchema } from './createChildProfileSchema';

function futureYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// api §4.3 `CreateChildProfileDto` mirror — name max100, dateOfBirth
// ISO + client age-derivation 1-18, gender enum. Task 14.3.
describe('createChildProfileSchema', () => {
  const base = { name: 'Alex', dateOfBirth: futureYearsAgo(10), gender: 'MALE' as const };

  it('accepts a valid child profile with only required fields', () => {
    const result = createChildProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('accepts optional school/photoUrl/trainerIds', () => {
    const result = createChildProfileSchema.safeParse({
      ...base,
      school: 'Lincoln Elementary',
      photoUrl: 'https://cdn.example.com/photo.jpg',
      trainerIds: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a name over 100 characters', () => {
    const result = createChildProfileSchema.safeParse({ ...base, name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects an age under 1 year', () => {
    const result = createChildProfileSchema.safeParse({ ...base, dateOfBirth: futureYearsAgo(0) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('dateOfBirth'))).toBe(true);
    }
  });

  it('rejects an age over 18 years', () => {
    const result = createChildProfileSchema.safeParse({ ...base, dateOfBirth: futureYearsAgo(19) });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date string', () => {
    const result = createChildProfileSchema.safeParse({ ...base, dateOfBirth: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown gender', () => {
    const result = createChildProfileSchema.safeParse({ ...base, gender: 'UNKNOWN' });
    expect(result.success).toBe(false);
  });
});
