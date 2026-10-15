// Sent to a player/parent who just registered anonymously through a
// trainer's ShareLink. No secret in this mail — its CTA is the login page.
export interface ShareLinkConfirmationTemplateData {
  firstName: string;
  trainerBusinessName: string;
}

export interface ShareLinkConfirmationEmailPayload {
  to: string;
  subject: string;
  templateData: ShareLinkConfirmationTemplateData;
}

export function buildShareLinkConfirmationEmailPayload(
  to: string,
  data: ShareLinkConfirmationTemplateData,
): ShareLinkConfirmationEmailPayload {
  return {
    to,
    subject: `You're connected with ${data.trainerBusinessName}`,
    templateData: data,
  };
}
