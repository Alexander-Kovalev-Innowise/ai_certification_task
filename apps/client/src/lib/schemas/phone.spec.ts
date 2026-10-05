import { optionalPhoneSchema, requiredPhoneSchema } from './phone';

describe('requiredPhoneSchema', () => {
  it('accepts a valid E.164 number', () => {
    expect(requiredPhoneSchema.safeParse('+14155552671').success).toBe(true);
    expect(requiredPhoneSchema.safeParse('+442079460958').success).toBe(true);
  });

  it('rejects an empty value with the required message', () => {
    const result = requiredPhoneSchema.safeParse('');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Phone number is required.');
  });

  it('rejects a number with no country code, a partial number, and garbage', () => {
    expect(requiredPhoneSchema.safeParse('4155552671').success).toBe(false);
    expect(requiredPhoneSchema.safeParse('+1415').success).toBe(false);
    expect(requiredPhoneSchema.safeParse('not a phone').success).toBe(false);
  });
});

describe('optionalPhoneSchema', () => {
  it('accepts undefined and empty string', () => {
    expect(optionalPhoneSchema.safeParse(undefined).success).toBe(true);
    expect(optionalPhoneSchema.safeParse('').success).toBe(true);
  });

  it('still rejects an invalid non-empty number', () => {
    expect(optionalPhoneSchema.safeParse('+1415').success).toBe(false);
  });
});
