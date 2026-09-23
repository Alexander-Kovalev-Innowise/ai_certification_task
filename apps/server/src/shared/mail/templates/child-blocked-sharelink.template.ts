// Task 4.8 (FR-052/SEC-006). Mirrors trainer-invite.template.ts's shape —
// OutboxService's dispatchEmail (Task 1.12) sends whatever
// `{to, subject, templateData}` the enqueued job's payload carries; this is
// where that shape gets built for the "a child tried to redeem a ShareLink"
// guardian-notification flow. Carries the raw ShareLink code (not a
// pre-built URL) — same convention as every other template in this
// directory — so the frontend composes the "Review Registration" CTA link
// from CLIENT_URL + this code.
export interface ChildBlockedShareLinkTemplateData {
  guardianFirstName: string;
  childFirstName: string;
  shareLinkCode: string;
}

export interface ChildBlockedShareLinkEmailPayload {
  to: string;
  subject: string;
  templateData: ChildBlockedShareLinkTemplateData;
}

export function buildChildBlockedShareLinkEmailPayload(
  to: string,
  data: ChildBlockedShareLinkTemplateData,
): ChildBlockedShareLinkEmailPayload {
  return {
    to,
    subject: 'Action needed: review a ShareLink registration attempt',
    templateData: data,
  };
}
