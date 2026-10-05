// Informational only (no action needed): a child spent tokens without needing
// approval because the guardian turned on `allowChildTokenSpendWithoutApproval`
// for that profile (FR-041). Sent to the guardian.
export interface ChildTokenSpendNoticeTemplateData {
  parentFirstName?: string;
  playerName: string;
  amount: string;
  title?: string | null;
}

export interface ChildTokenSpendNoticeEmailPayload {
  to: string;
  subject: string;
  templateData: ChildTokenSpendNoticeTemplateData;
}

export function buildChildTokenSpendNoticeEmailPayload(
  to: string,
  data: ChildTokenSpendNoticeTemplateData,
): ChildTokenSpendNoticeEmailPayload {
  return {
    to,
    subject: `${data.playerName} spent tokens (no approval needed)`,
    templateData: data,
  };
}
