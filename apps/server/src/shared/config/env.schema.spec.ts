import { areRateLimitsDisabled, isDevMailboxEnabled, validateEnv } from './env.schema';

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
  describe('MAIL_PROVIDER / SMTP', () => {
    it.each(['console', 'ses', 'dev'] as const)('accepts MAIL_PROVIDER=%s without SMTP vars', (provider) => {
      expect(validateEnv({ ...validEnv, MAIL_PROVIDER: provider }).MAIL_PROVIDER).toBe(provider);
    });

    it('requires SMTP_URL and MAIL_FROM when MAIL_PROVIDER=smtp', () => {
      expect(() => validateEnv({ ...validEnv, MAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_URL/);
      expect(() => validateEnv({ ...validEnv, MAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://localhost:1025' })).toThrow(/MAIL_FROM/);
    });

    it('accepts smtp with both vars', () => {
      const result = validateEnv({ ...validEnv, MAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'a@b.c' });
      expect(result.SMTP_URL).toBe('smtp://localhost:1025');
    });

    it('rejects an unknown provider', () => {
      expect(() => validateEnv({ ...validEnv, MAIL_PROVIDER: 'carrier-pigeon' })).toThrow();
    });
  });

  describe('RATE_LIMITS_DISABLED', () => {
    it('defaults to false', () => {
      expect(validateEnv(validEnv).RATE_LIMITS_DISABLED).toBe(false);
    });

    it('is honoured outside production', () => {
      expect(areRateLimitsDisabled(validateEnv({ ...validEnv, RATE_LIMITS_DISABLED: 'true', NODE_ENV: 'test' }))).toBe(true);
      expect(areRateLimitsDisabled(validateEnv({ ...validEnv, RATE_LIMITS_DISABLED: 'true' }))).toBe(true);
    });

    it('is inert in production', () => {
      const parsed = validateEnv({ ...validEnv, RATE_LIMITS_DISABLED: 'true', NODE_ENV: 'production' });
      expect(parsed.RATE_LIMITS_DISABLED).toBe(true);
      expect(areRateLimitsDisabled(parsed)).toBe(false);
    });
  });

  describe('isDevMailboxEnabled', () => {
    it('is true only for MAIL_PROVIDER=dev outside production', () => {
      expect(isDevMailboxEnabled(validateEnv({ ...validEnv, MAIL_PROVIDER: 'dev', NODE_ENV: 'test' }))).toBe(true);
      expect(isDevMailboxEnabled(validateEnv({ ...validEnv, MAIL_PROVIDER: 'dev', NODE_ENV: 'production' }))).toBe(false);
      expect(isDevMailboxEnabled(validateEnv({ ...validEnv, MAIL_PROVIDER: 'console' }))).toBe(false);
    });
  });
});

describe('validateEnv — storage settings', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 's' };

  it('defaults UPLOADS_DIR to "uploads" and PUBLIC_API_URL to http://localhost:<PORT>', () => {
    const result = validateEnv({ ...base, PORT: '4100' });
    expect(result.UPLOADS_DIR).toBe('uploads');
    expect(result.PUBLIC_API_URL).toBe('http://localhost:4100');
  });

  it('respects an explicit PUBLIC_API_URL and strips trailing slashes', () => {
    const result = validateEnv({ ...base, PUBLIC_API_URL: 'https://api.example.com/' });
    expect(result.PUBLIC_API_URL).toBe('https://api.example.com');
  });
});
