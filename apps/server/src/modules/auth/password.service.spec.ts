import { PasswordService } from './password.service';

describe('PasswordService (Task 2.11)', () => {
  const service = new PasswordService();

  it('hash/verify round-trips for the correct password', async () => {
    const hash = await service.hash('CorrectHorseBattery1');
    await expect(service.verify(hash, 'CorrectHorseBattery1')).resolves.toBe(true);
  });

  it('rejects the wrong password against a real hash', async () => {
    const hash = await service.hash('CorrectHorseBattery1');
    await expect(service.verify(hash, 'WrongPassword1')).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await service.hash('CorrectHorseBattery1');
    const b = await service.hash('CorrectHorseBattery1');
    expect(a).not.toBe(b);
  });

  // Loose timing assertion, not exact — proves dummyHash() does real argon2
  // work (FR-002) rather than resolving near-instantly, which is the
  // anti-enumeration property that matters (a "no such user" branch must
  // not respond measurably faster than a "wrong password" branch).
  it('dummyHash() takes roughly the same wall-clock time as a real verify', async () => {
    const hash = await service.hash('CorrectHorseBattery1');

    const verifyStart = Date.now();
    await service.verify(hash, 'WrongPassword1');
    const verifyDuration = Date.now() - verifyStart;

    const dummyStart = Date.now();
    await service.dummyHash();
    const dummyDuration = Date.now() - dummyStart;

    // Both should be real argon2id work at the configured cost, so neither
    // should be near-zero, and neither should be wildly (>5x) slower than
    // the other.
    expect(verifyDuration).toBeGreaterThan(0);
    expect(dummyDuration).toBeGreaterThan(0);
    const ratio = Math.max(verifyDuration, dummyDuration) / Math.max(1, Math.min(verifyDuration, dummyDuration));
    expect(ratio).toBeLessThan(5);
  });
});
