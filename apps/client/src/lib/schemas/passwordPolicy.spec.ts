import { passwordPolicySchema } from './passwordPolicy';

describe('passwordPolicySchema', () => {
  it('accepts a password with lowercase, uppercase, and a digit, at least 8 chars', () => {
    expect(passwordPolicySchema.safeParse('Passw0rd').success).toBe(true);
  });

  it('rejects a password under 8 characters', () => {
    expect(passwordPolicySchema.safeParse('Pw0rd').success).toBe(false);
  });

  it('rejects a password missing an uppercase letter', () => {
    expect(passwordPolicySchema.safeParse('password1').success).toBe(false);
  });

  it('rejects a password missing a lowercase letter', () => {
    expect(passwordPolicySchema.safeParse('PASSWORD1').success).toBe(false);
  });

  it('rejects a password missing a digit', () => {
    expect(passwordPolicySchema.safeParse('Password').success).toBe(false);
  });

  it('does not require a special character', () => {
    expect(passwordPolicySchema.safeParse('Password1').success).toBe(true);
  });
});
