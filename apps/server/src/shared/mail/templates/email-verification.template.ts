// Mirrors password-reset.template.ts. Carries the RAW opaque token (only
// available at creation time — the DB stores its hash); the link itself is
// composed at render time by mail-renderer.ts from CLIENT_URL.
export interface EmailVerificationTemplateData {
  firstName: string;
  verificationToken: string;
}

export interface EmailVerificationEmailPayload {
  to: string;
  subject: string;
  templateData: EmailVerificationTemplateData;
}

export function buildEmailVerificationEmailPayload(
  to: string,
  data: EmailVerificationTemplateData,
): EmailVerificationEmailPayload {
  return {
    to,
    subject: 'Verify your PracticePerfect email address',
    templateData: data,
  };
}
