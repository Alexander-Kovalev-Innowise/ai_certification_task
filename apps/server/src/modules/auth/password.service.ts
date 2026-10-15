import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// Task 2.11 (NFR-006, arch §6.1). argon2id, OWASP baseline params.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// A fixed plaintext for dummyHash() — its value is never compared against
// anything and never stored; it exists purely to give argon2 something to
// chew on for the same amount of work a real hash/verify call would take.
const DUMMY_PASSWORD = 'dummy-password-for-timing-parity';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /**
   * FR-002 anti-enumeration: computes a wasted argon2 hash so a "no such
   * user" lookup takes roughly the same wall-clock time as a real
   * hash/verify call, and a client can't distinguish "unknown email" from
   * "wrong password" by response timing. Deliberately NOT memoized/cached —
   * caching the computed hash would make every call after the first
   * near-instant, defeating the timing parity this exists for.
   */
  async dummyHash(): Promise<void> {
    await argon2.hash(DUMMY_PASSWORD, ARGON2_OPTIONS);
  }
}
