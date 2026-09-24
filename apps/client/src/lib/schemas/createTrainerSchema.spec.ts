import { createTrainerSchema } from './createTrainerSchema';

const VALID = {
  businessName: 'Ace Tennis Academy',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+14155552671',
};

// fe §11.1/§4.3 — CreateTrainerDto's resolved two-name-field shape
// (`businessName` max200, `firstName` max100, `lastName` max100, valid
// `email`, E.164-ish `phone`). Task 12.4.
describe('createTrainerSchema', () => {
  it('accepts a fully valid payload', () => {
    expect(createTrainerSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects a businessName over 200 characters', () => {
    const result = createTrainerSchema.safeParse({ ...VALID, businessName: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects a firstName over 100 characters', () => {
    const result = createTrainerSchema.safeParse({ ...VALID, firstName: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects a lastName over 100 characters', () => {
    const result = createTrainerSchema.safeParse({ ...VALID, lastName: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = createTrainerSchema.safeParse({ ...VALID, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-E.164 phone number', () => {
    const result = createTrainerSchema.safeParse({ ...VALID, phone: 'not a phone number' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty businessName', () => {
    const result = createTrainerSchema.safeParse({ ...VALID, businessName: '' });
    expect(result.success).toBe(false);
  });
});
