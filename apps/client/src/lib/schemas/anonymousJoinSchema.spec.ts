import { anonymousCoachAcceptSchema, anonymousPlayerRegistrationSchema } from './anonymousJoinSchema';

function futureIsoDate(yearsFromNow: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearsFromNow);
  return d.toISOString().slice(0, 10);
}

function pastIsoDate(yearsAgo: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
}

describe('anonymousPlayerRegistrationSchema', () => {
  const base = {
    email: 'parent@example.com',
    password: 'Password1',
    phone: '+15551234567',
    playerName: 'Alex',
    gender: 'MALE' as const,
  };

  it('accepts a valid child registration (isSelf: false) aged 1-18', () => {
    const result = anonymousPlayerRegistrationSchema.safeParse({ ...base, dateOfBirth: pastIsoDate(10), isSelf: false });

    expect(result.success).toBe(true);
  });

  it('rejects a child registration (isSelf: false) outside the 1-18 range', () => {
    const result = anonymousPlayerRegistrationSchema.safeParse({ ...base, dateOfBirth: pastIsoDate(25), isSelf: false });

    expect(result.success).toBe(false);
  });

  it('accepts an adult self-registration (isSelf: true) even though age is well over 18', () => {
    // The server (ShareLinkRedemptionService) applies no age-range check on
    // this endpoint at all, and isSelf:true routinely registers an adult
    // PLAYER_PARENT training themselves — see anonymousJoinSchema.ts's own
    // comment on this verified deviation from the plan's literal text.
    const result = anonymousPlayerRegistrationSchema.safeParse({ ...base, dateOfBirth: pastIsoDate(35), isSelf: true });

    expect(result.success).toBe(true);
  });

  it('rejects a date of birth in the future regardless of isSelf', () => {
    const result = anonymousPlayerRegistrationSchema.safeParse({ ...base, dateOfBirth: futureIsoDate(1), isSelf: true });

    expect(result.success).toBe(false);
  });

  it('rejects a password that fails PASSWORD_POLICY', () => {
    const result = anonymousPlayerRegistrationSchema.safeParse({
      ...base,
      password: 'weak',
      dateOfBirth: pastIsoDate(10),
      isSelf: false,
    });

    expect(result.success).toBe(false);
  });
});

describe('anonymousCoachAcceptSchema', () => {
  it('accepts a password satisfying PASSWORD_POLICY and requires nothing else', () => {
    expect(anonymousCoachAcceptSchema.safeParse({ password: 'Password1' }).success).toBe(true);
  });

  it('rejects a weak password', () => {
    expect(anonymousCoachAcceptSchema.safeParse({ password: 'weak' }).success).toBe(false);
  });
});
