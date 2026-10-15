import { buildChangePasswordSchema } from './changePasswordSchema';

describe('buildChangePasswordSchema', () => {
  it('requires currentPassword when requireCurrentPassword is true', () => {
    const schema = buildChangePasswordSchema(true);

    expect(schema.safeParse({ newPassword: 'Password1' }).success).toBe(false);
    expect(schema.safeParse({ currentPassword: 'Old1Pass', newPassword: 'Password1' }).success).toBe(true);
  });

  it('does not require currentPassword when requireCurrentPassword is false', () => {
    const schema = buildChangePasswordSchema(false);

    expect(schema.safeParse({ newPassword: 'Password1' }).success).toBe(true);
  });

  it('always enforces PASSWORD_POLICY on newPassword', () => {
    const schema = buildChangePasswordSchema(false);

    expect(schema.safeParse({ newPassword: 'weak' }).success).toBe(false);
  });
});
