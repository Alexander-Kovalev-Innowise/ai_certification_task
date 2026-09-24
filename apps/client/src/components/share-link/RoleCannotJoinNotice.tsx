// fe §4.2 — "access token present, role=TRAINER|SUPER_ADMIN → render
// <RoleCannotJoinNotice> WITHOUT calling redeem (pre-empts the 409
// ROLE_CANNOT_REDEEM_SHARE_LINK for the same UX-nicety-not-security reason
// as the CHILD branch)." Matches the server's own message
// (share-link-redemption.service.ts: "A trainer or Super Admin cannot
// redeem a ShareLink" — "a trainer cannot be someone's player in Epic-01").
export function RoleCannotJoinNotice() {
  return (
    <div
      role="alert"
      className="flex flex-col gap-sm rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg text-center"
    >
      <p className="text-body text-[var(--text-primary)]">
        This invitation is for players and coaches. Your account can&apos;t join as a participant.
      </p>
    </div>
  );
}
