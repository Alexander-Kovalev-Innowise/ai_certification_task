import { requestOverrideChangeSchema } from './requestOverrideChangeSchema';

describe('requestOverrideChangeSchema', () => {
  it('trims and accepts 5-500 characters', () => {
    expect(requestOverrideChangeSchema.parse({ message: '  Move it please  ' })).toEqual({ message: 'Move it please' });
    expect(requestOverrideChangeSchema.safeParse({ message: 'x'.repeat(500) }).success).toBe(true);
  });

  it.each(['', 'abcd', '     ', 'x'.repeat(501)])('rejects %j', (message) => {
    expect(requestOverrideChangeSchema.safeParse({ message }).success).toBe(false);
  });
});
