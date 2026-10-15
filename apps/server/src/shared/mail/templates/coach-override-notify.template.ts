// Task 6.3 (api §4.5 "POST /coaches/:id/availability/override", Gap G-06's
// default of "notify coach" — flagged there as P2/open, included since the
// architecture doc took no position against the requirements doc's
// default). Mirrors this directory's other templates' `{to, subject,
// templateData}` shape — OutboxService.dispatchEmail (Task 1.12) sends
// whatever the enqueued job's payload carries. The coach is never blocked
// (BR-012) — this email is purely informational, sent after the override
// row has already committed.
export interface CoachOverrideNotifyTemplateData {
  coachFirstName: string;
  trainerBusinessName: string;
  reason: string;
}

export interface CoachOverrideNotifyEmailPayload {
  to: string;
  subject: string;
  templateData: CoachOverrideNotifyTemplateData;
}

export function buildCoachOverrideNotifyEmailPayload(
  to: string,
  data: CoachOverrideNotifyTemplateData,
): CoachOverrideNotifyEmailPayload {
  return {
    to,
    subject: `${data.trainerBusinessName} scheduled you despite an availability conflict`,
    templateData: data,
  };
}
