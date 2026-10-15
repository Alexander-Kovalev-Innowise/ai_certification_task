// A child asked their guardian to approve a purchase (FR-040/FR-041). The
// CTA deep-links to the guardian's approvals queue (`/approvals`), which
// needs a logged-in session — no secret travels in this mail. Nothing
// enqueues this job yet (child checkout lands with Epic-05); the builder
// exists so that flow has a typed payload to enqueue.
export interface ChildApprovalRequestTemplateData {
  parentFirstName?: string;
  playerName: string;
  amount: string;
  paymentType: 'USD' | 'TOKEN';
  description?: string | null;
}

export interface ChildApprovalRequestEmailPayload {
  to: string;
  subject: string;
  templateData: ChildApprovalRequestTemplateData;
}

export function buildChildApprovalRequestEmailPayload(
  to: string,
  data: ChildApprovalRequestTemplateData,
): ChildApprovalRequestEmailPayload {
  return {
    to,
    subject: `${data.playerName} is asking for your approval`,
    templateData: data,
  };
}
