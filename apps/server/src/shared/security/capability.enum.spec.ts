import { Capability, CHILD_DENIED } from './capability.enum';

// Task 2.1 — no Testcontainers/DB needed, this is pure metadata. No **Tests:**
// section named in the plan for this task, but the deny-list is
// security-critical (a false-negative here silently reopens FR-050/FR-051),
// so it gets a light unit test anyway per the TDD convention stated once in
// the plan's preamble.
describe('Capability / CHILD_DENIED (Task 2.1)', () => {
  it('denies every capability api §0.7 documents as unavailable to a CHILD login', () => {
    expect(CHILD_DENIED.has(Capability.REDEEM_SHARE_LINK)).toBe(true);
    expect(CHILD_DENIED.has(Capability.MANAGE_TRAINER_ASSOCIATIONS)).toBe(true);
    expect(CHILD_DENIED.has(Capability.MANAGE_PAYMENT_METHODS)).toBe(true);
    expect(CHILD_DENIED.has(Capability.PURCHASE_TOKENS)).toBe(true);
    expect(CHILD_DENIED.has(Capability.COMPLETE_PURCHASE)).toBe(true);
    expect(CHILD_DENIED.has(Capability.DELETE_OWN_ACCOUNT)).toBe(true);
    expect(CHILD_DENIED.has(Capability.VIEW_GUARDIAN_DATA)).toBe(true);
    expect(CHILD_DENIED.has(Capability.MANAGE_CHILD_PROFILES)).toBe(true);
    expect(CHILD_DENIED.has(Capability.APPROVE_CHILD_PURCHASE)).toBe(true);
  });

  it('does not deny capabilities a CHILD login is meant to retain (e.g. editing own profile)', () => {
    expect(CHILD_DENIED.has(Capability.EDIT_OWN_PROFILE)).toBe(false);
    expect(CHILD_DENIED.has(Capability.SET_OWN_AVAILABILITY)).toBe(false);
    expect(CHILD_DENIED.has(Capability.VIEW_PLAYER_AVAILABILITY)).toBe(false);
  });

  it('has 23 distinct capability values (api §0.7 catalog size)', () => {
    const values = Object.values(Capability).filter((v) => typeof v === 'number');
    expect(values).toHaveLength(23);
  });
});
