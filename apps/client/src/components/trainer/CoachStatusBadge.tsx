export type CoachInvitationStatus = 'Pending' | 'Accepted' | 'Expired';

export interface CoachStatusBadgeProps {
  status: CoachInvitationStatus;
}

// api §4.2 GET /trainers/:id/coaches — `CoachRosterRowDto.invitationStatus`,
// the roster's own derived field (distinct from the row's raw `status`).
// Colors follow the shared surface/text tokens: amber for outstanding
// invites, the brand-adjacent success green for accepted, danger red for
// expired.
const STYLES: Record<CoachInvitationStatus, string> = {
  Pending: 'bg-[var(--warning)]/20 text-[var(--warning)]',
  Accepted: 'bg-[var(--success)]/20 text-[var(--success)]',
  Expired: 'bg-[var(--danger)]/20 text-[var(--danger)]',
};

// fe §4.4 — CoachStatusBadge (Pending/Accepted/Expired). Task 13.2.
export function CoachStatusBadge({ status }: CoachStatusBadgeProps) {
  return (
    <span className={`rounded-full px-sm py-xxs text-caption font-semibold ${STYLES[status]}`}>{status}</span>
  );
}
