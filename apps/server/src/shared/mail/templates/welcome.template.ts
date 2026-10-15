// Sent once, when an account is first activated (trainer finishing the setup
// link, coach accepting an invite). No secret in this mail - its CTA is the
// login page. Anonymous ShareLink registrations get the registration
// confirmation instead (sharelink-confirmation.template.ts), never both.
export interface WelcomeTemplateData {
  firstName: string;
}

export interface WelcomeEmailPayload {
  to: string;
  subject: string;
  templateData: WelcomeTemplateData;
}

export function buildWelcomeEmailPayload(to: string, data: WelcomeTemplateData): WelcomeEmailPayload {
  return {
    to,
    subject: 'Welcome to PracticePerfect',
    templateData: data,
  };
}
