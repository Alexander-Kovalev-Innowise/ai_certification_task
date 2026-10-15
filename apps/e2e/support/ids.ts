let counter = 0;

/** Short unique token, safe for emails/names: `e2e-lk3j9a-x7q2-1`. Unique across runs and tests. */
export function uid(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${counter}`;
}

/** Unique email (the dev mailbox never really sends): `trainer-lk3j9a-x7q2-1@e2e.test`. */
export function uniqueEmail(prefix = 'user'): string {
  return `${uid(prefix)}@e2e.test`;
}

/** Unique name pair so tables/search can find exactly this test's rows. */
export function uniqueName(prefix = 'E2E'): { firstName: string; lastName: string } {
  // Letters only: the app's name validation rejects digits.
  const token = uid('x')
    .split('-')
    .slice(1)
    .join('')
    .slice(0, 10)
    .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  return { firstName: prefix, lastName: `Tester${token}` };
}

/** A password intended to satisfy the password policy (length, upper/lower/digit/symbol). */
export function strongPassword(): string {
  return `Pw!${uid('p').replace(/-/g, '')}Aa1`;
}
