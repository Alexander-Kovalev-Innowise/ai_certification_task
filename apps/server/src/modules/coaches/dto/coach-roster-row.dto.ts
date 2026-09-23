// Task 4.12 (api §4.2 "GET /trainers/:id/coaches"). One roster row — either
// an accepted/pending `CoachProfile` (a real coach account exists), or a
// still-outstanding `ShareLink(COACH_UNIQUE)` invite (no account yet, so
// `userId`/`name`/`joinedAt` are `null` and `id` is the ShareLink's own id
// instead of a CoachProfile id). `invitationStatus` is the roster's own
// derived field (FR-060's "trainer can view invitation status") — distinct
// from `status`, which is whichever raw enum the row's underlying source
// carries (`CoachStatus` for an accepted/pending profile, the literal string
// `'PENDING'`/`'EXPIRED'` for an invite-only row with no profile yet).
export class CoachRosterRowDto {
  id!: string;
  userId!: string | null;
  name!: string | null;
  email!: string;
  status!: string;
  bio?: string | null;
  joinedAt!: Date | null;
  invitationStatus!: 'Pending' | 'Accepted' | 'Expired';
}
