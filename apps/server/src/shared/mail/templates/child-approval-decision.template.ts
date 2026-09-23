// Task 5.13 (api §4.6 "POST /approvals/:id/deny", plus the 5-minute
// `ApprovalExpiryJob` sweep, FR-042). Mirrors this directory's other
// templates' `{to, subject, templateData}` shape — `OutboxService.dispatchEmail`
// (Task 1.12) sends whatever the enqueued job's payload carries.
export interface ChildApprovalDecisionTemplateData {
  playerName: string;
  amount: string;
  paymentType: 'USD' | 'TOKEN';
  decision: 'DENIED' | 'EXPIRED';
  parentNotes?: string | null;
}

export interface ChildApprovalDecisionEmailPayload {
  to: string;
  subject: string;
  templateData: ChildApprovalDecisionTemplateData;
}

const SUBJECT_BY_DECISION: Record<ChildApprovalDecisionTemplateData['decision'], string> = {
  DENIED: 'Your purchase request was denied',
  EXPIRED: 'Your purchase request has expired',
};

export function buildChildApprovalDecisionEmailPayload(
  to: string,
  data: ChildApprovalDecisionTemplateData,
): ChildApprovalDecisionEmailPayload {
  return {
    to,
    subject: SUBJECT_BY_DECISION[data.decision],
    templateData: data,
  };
}
