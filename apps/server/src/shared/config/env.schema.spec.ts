import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/practiceperfect',
    JWT_SECRET: 'a-strong-secret',
  };

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('parses a valid env', () => {
    const result = validateEnv(validEnv);
    expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(result.JWT_SECRET).toBe(validEnv.JWT_SECRET);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
  });

  it('defaults SCHEDULER_ENABLED to true when unset', () => {
    const result = validateEnv(validEnv);
    expect(result.SCHEDULER_ENABLED).toBe(true);
  });

  it('parses SCHEDULER_ENABLED=false as false', () => {
    const result = validateEnv({ ...validEnv, SCHEDULER_ENABLED: 'false' });
    expect(result.SCHEDULER_ENABLED).toBe(false);
  });

  it('parses SCHEDULER_ENABLED=true as true', () => {
    const result = validateEnv({ ...validEnv, SCHEDULER_ENABLED: 'true' });
    expect(result.SCHEDULER_ENABLED).toBe(true);
  });

  it('respects an explicit PORT', () => {
    const result = validateEnv({ ...validEnv, PORT: '4000' });
    expect(result.PORT).toBe(4000);
  });
});
