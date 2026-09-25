import Link from 'next/link';

// fe §4.7/Task 18.1 — `/account/profile`'s entry point into the voluntary
// change-password path. `ChangePasswordForm` (Task 11.6) already derives its
// forced-vs-voluntary mode from the CURRENT session's `user.mustChangePassword`
// rather than a prop, so both mount sites (the forced `/change-password`
// landing and this link) get correct behavior automatically — this component
// is deliberately just a link, not a duplicate form.
export function ChangePasswordLink() {
  return (
    <Link href="/change-password" className="text-body font-semibold text-[var(--brand-primary)] underline underline-offset-2 hover:text-[var(--brand-primary-soft)]">
      Change password
    </Link>
  );
}
