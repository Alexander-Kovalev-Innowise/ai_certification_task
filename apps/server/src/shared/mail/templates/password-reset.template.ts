// Task 2.16. OutboxService's dispatchEmail (Task 1.12) sends whatever
// `{to, subject, templateData}` the enqueued job's payload carries — it
// does not render templates itself. This is where that shape gets built
// for the password-reset flow, kept separate from AuthService so the
// email copy isn't buried in business logic.
//
// Deliberately its own return type rather than `Pick<SendMailOptions, ...>`:
// SendMailOptions.templateData is `Record<string, unknown>`, and a named
// interface (as opposed to a fresh object literal) isn't structurally
// assignable to an indexed type in TypeScript without an explicit index
// signature — this return type sidesteps that friction entirely. The
// caller (AuthService) is the one that needs the result to satisfy
// Prisma's `InputJsonValue` when enqueueing, which it casts explicitly.
export interface PasswordResetTemplateData {
  firstName: string;
  resetToken: string;
}

export interface PasswordResetEmailPayload {
  to: string;
  subject: string;
  templateData: PasswordResetTemplateData;
}

export function buildPasswordResetEmailPayload(to: string, data: PasswordResetTemplateData): PasswordResetEmailPayload {
  return {
    to,
    subject: 'Reset your PracticePerfect password',
    templateData: data,
  };
}
