// Task 2.1 (api §0.7, verbatim). Fine-grained authorization gate read by
// CapabilitiesGuard (Task 2.6) via @RequiresCapability(...) (Task 2.3). Every
// non-@Public() route must carry one of these — enforced as a build failure
// by the boot-time assertion (Task 2.8, arch §9.2/§20).
export enum Capability {
  CREATE_TRAINER_ACCOUNT,
  MANAGE_ANY_USER,
  DEACTIVATE_REACTIVATE_USER,
  GDPR_DELETE_USER,
  IMPERSONATE_USER,
  GENERATE_SHARE_LINK,
  REDEEM_SHARE_LINK,
  INVITE_COACH,
  VIEW_OWN_COACH_ROSTER,
  MANAGE_COACH_PROFILE,
  MANAGE_PORTAL_BRANDING,
  MANAGE_CHILD_PROFILES,
  MANAGE_TRAINER_ASSOCIATIONS,
  SET_OWN_AVAILABILITY,
  VIEW_PLAYER_AVAILABILITY,
  OVERRIDE_COACH_CONFLICT,
  APPROVE_CHILD_PURCHASE,
  EDIT_OWN_PROFILE,
  DELETE_OWN_ACCOUNT,
  VIEW_GUARDIAN_DATA,
  MANAGE_PAYMENT_METHODS,
  PURCHASE_TOKENS,
  COMPLETE_PURCHASE,
}

// arch §9.2 / api §0.7 verbatim, plus api §0.7's resolved addition of
// APPROVE_CHILD_PURCHASE (reconciles the literal CHILD_DENIED set with the
// §7.3 role matrix, which shows "Approve/deny child purchase" as denied for
// a child login — flagged in the api spec for product sign-off, not a
// deviation introduced here).
export const CHILD_DENIED: ReadonlySet<Capability> = new Set([
  Capability.REDEEM_SHARE_LINK,
  Capability.MANAGE_TRAINER_ASSOCIATIONS,
  Capability.MANAGE_PAYMENT_METHODS,
  Capability.PURCHASE_TOKENS,
  Capability.COMPLETE_PURCHASE,
  Capability.DELETE_OWN_ACCOUNT,
  Capability.VIEW_GUARDIAN_DATA,
  Capability.MANAGE_CHILD_PROFILES,
  Capability.APPROVE_CHILD_PURCHASE,
]);
