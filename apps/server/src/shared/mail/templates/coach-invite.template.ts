// Task 4.11 (api §4.2 "POST /coaches/invite", FR-060). Mirrors
// trainer-invite.template.ts's shape — OutboxService's dispatchEmail (Task
// 1.12) sends whatever `{to, subject, templateData}` the enqueued job's
// payload carries. Carries the raw ShareLink code (not a pre-built URL),
// same convention as every other template in this directory — the frontend
// composes the actual join-link URL from CLIENT_URL + this code.
export interface CoachInviteTemplateData {
  trainerBusinessName: string;
  inviteeName?: string;
  message?: string;
  shareLinkCode: string;
}

export interface CoachInviteEmailPayload {
  to: string;
  subject: string;
  templateData: CoachInviteTemplateData;
}

export function buildCoachInviteEmailPayload(to: string, data: CoachInviteTemplateData): CoachInviteEmailPayload {
  return {
    to,
    subject: `${data.trainerBusinessName} invited you to coach on PracticePerfect`,
    templateData: data,
  };
}
