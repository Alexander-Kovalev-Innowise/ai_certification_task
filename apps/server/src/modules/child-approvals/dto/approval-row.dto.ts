// Task 5.12 (api §4.6 "GET /approvals", reproduced verbatim). One row per
// pending/resolved child purchase request. `ChildPurchaseApproval` has no
// `trainerId` column (api §0.3/§4.6) — a parent's approval queue spans every
// trainer their children train with, by design (it's the parent's inbox).
// `eventId` is null for child-initiated stand-in requests (POST
// /me/purchase-requests) until the Epic-02/05 checkout supplies one.
export class ApprovalRowDto {
  id!: string;
  playerProfileId!: string;
  playerName!: string;
  eventId!: string | null;
  title?: string | null;
  amount!: string;
  paymentType!: 'USD' | 'TOKEN';
  status!: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  requestedAt!: string;
  expiresAt!: string;
  respondedAt?: string | null;
  parentNotes?: string | null;
  infoRequestMessage?: string | null;
  infoRequestedAt?: string | null;
}
