import type { SendMailOptions } from '../mail.service';

// Task 2.16. OutboxService's dispatchEmail (Task 1.12) sends whatever
// `{to, subject, templateData}` the enqueued job's payload carries — it
// does not render templates itself. This is where that shape gets built
// for the password-reset flow, kept separate from AuthService so the
// email copy isn't buried in business logic.
export interface PasswordResetTemplateData {
  firstName: string;
  resetToken: string;
}

export function buildPasswordResetEmailPayload(
  to: string,
  data: PasswordResetTemplateData,
): Pick<SendMailOptions, 'to' | 'subject' | 'templateData'> {
  return {
    to,
    subject: 'Reset your PracticePerfect password',
    templateData: data,
  };
}
