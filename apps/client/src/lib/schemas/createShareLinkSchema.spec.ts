import { createShareLinkSchema } from './createShareLinkSchema';

// fe §4.4/§9's DTO-mirroring table — createShareLinkSchema mirrors
// `CreateShareLinkDto`: `type` enum `PLAYER_STATIC | COACH_UNIQUE`,
// `targetEmail` conditionally required via `.superRefine` mirroring the
// server DTO's `@ValidateIf(o => o.type === 'COACH_UNIQUE')`. Task 13.3.
describe('createShareLinkSchema', () => {
  it('accepts a PLAYER_STATIC link with no targetEmail', () => {
    const result = createShareLinkSchema.safeParse({ type: 'PLAYER_STATIC' });
    expect(result.success).toBe(true);
  });

  it('accepts a COACH_UNIQUE link with a valid targetEmail', () => {
    const result = createShareLinkSchema.safeParse({ type: 'COACH_UNIQUE', targetEmail: 'cam@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects a COACH_UNIQUE link with no targetEmail', () => {
    const result = createShareLinkSchema.safeParse({ type: 'COACH_UNIQUE' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('targetEmail'))).toBe(true);
    }
  });

  it('rejects a COACH_UNIQUE link with an invalid targetEmail', () => {
    const result = createShareLinkSchema.safeParse({ type: 'COACH_UNIQUE', targetEmail: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown type', () => {
    const result = createShareLinkSchema.safeParse({ type: 'SOMETHING_ELSE' });
    expect(result.success).toBe(false);
  });
});
