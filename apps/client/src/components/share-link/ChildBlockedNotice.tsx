// fe §4.2 — "access token present, accountType=CHILD → render
// <ChildBlockedNotice> WITHOUT calling redeem at all — the client already
// knows this will 403; pre-empting the call is a UX nicety, not a security
// control (server still enforces CHILD_SHARE_LINK_BLOCKED independently)."
//
// DEVIATION (verified against
// apps/server/.../share-link-redemption.service.ts): the plan's suggested
// copy ends with "State that the parent has already been emailed" — but
// that guardian email (`OutboxJob(EMAIL_CHILD_BLOCKED_SHARELINK)`) is a
// side effect of the SERVER actually processing a redeem attempt (Task
// 4.8), which this pre-empting notice deliberately never triggers. Claiming
// the parent "has already been emailed" here would be false. This notice
// keeps the plan's exact mandated first sentence and replaces the second
// with an accurate call to action instead (share the link with the parent)
// rather than asserting a side effect that never ran.
export function ChildBlockedNotice() {
  return (
    <div
      role="alert"
      className="flex flex-col gap-sm rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg text-center"
    >
      <p className="text-body text-[var(--text-primary)]">Ask your parent to register you with this trainer.</p>
      <p className="text-caption text-[var(--text-secondary)]">
        Share this invitation link with them so they can complete your registration.
      </p>
    </div>
  );
}
