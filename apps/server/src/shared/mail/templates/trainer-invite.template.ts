// Task 3.8. Mirrors password-reset.template.ts's shape exactly: OutboxService's
// dispatchEmail (Task 1.12) sends whatever {to, subject, templateData} the
// enqueued job's payload carries and does not render templates itself; this
// is where that shape gets built for the trainer-invite flow. Carries the
// raw opaque setup token (not a pre-built URL) in templateData, same as the
// password-reset template — the frontend composes the actual setup-link URL
// from CLIENT_URL + this token, consistent with how the existing
// forgot-password flow already works.
export interface TrainerInviteTemplateData {
  firstName: string;
  businessName: string;
  setupToken: string;
}

export interface TrainerInviteEmailPayload {
  to: string;
  subject: string;
  templateData: TrainerInviteTemplateData;
}

export function buildTrainerInviteEmailPayload(to: string, data: TrainerInviteTemplateData): TrainerInviteEmailPayload {
  return {
    to,
    subject: 'Welcome to PracticePerfect — complete your trainer account setup',
    templateData: data,
  };
}
