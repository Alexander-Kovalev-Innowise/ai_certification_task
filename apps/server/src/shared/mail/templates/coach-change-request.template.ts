// US-01.10 "request change": the coach asks the employing trainer to change an
// assignment that conflicts with their availability. Same `{to, subject,
// templateData}` shape as the sibling templates; rendered by shared/mail's
// renderer (EMAIL_COACH_CHANGE_REQUEST), link target is the trainer's /coaches page.
export interface CoachChangeRequestTemplateData {
  trainerFirstName: string;
  coachName: string;
  message: string;
  sessionLabel?: string;
}

export interface CoachChangeRequestEmailPayload {
  to: string;
  subject: string;
  templateData: CoachChangeRequestTemplateData;
}

export function buildCoachChangeRequestEmailPayload(to: string, data: CoachChangeRequestTemplateData): CoachChangeRequestEmailPayload {
  return {
    to,
    subject: `${data.coachName} asked you to change an assignment`,
    templateData: data,
  };
}
