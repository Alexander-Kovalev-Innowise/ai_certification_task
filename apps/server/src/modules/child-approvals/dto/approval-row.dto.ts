// Task 5.12 (api §4.6 "GET /approvals", reproduced verbatim). One row per
// pending/resolved child purchase request. `ChildPurchaseApproval` has no
// `trainerId` column (api §0.3/§4.6) — a parent's approval queue spans every
// trainer their children train with, by design (it's the parent's inbox).
export class ApprovalRowDto {
  id!: string;
  playerProfileId!: string;
  playerName!: string;
  eventId!: string;
  amount!: string;
  paymentType!: 'USD' | 'TOKEN';
  status!: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  requestedAt!: string;
  expiresAt!: string;
  respondedAt?: string | null;
  parentNotes?: string | null;
}
