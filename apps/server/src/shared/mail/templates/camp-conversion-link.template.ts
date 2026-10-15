// Camp/evaluation sign-up -> "register later" mail. Carries the raw ShareLink code + conversion token (like the
// other templates the frontend-facing URL is composed by the renderer from CLIENT_URL).
export interface CampConversionLinkTemplateData {
  firstName: string;
  trainerBusinessName: string;
  shareLinkCode: string;
  conversionToken: string;
}

export interface CampConversionLinkEmailPayload {
  to: string;
  subject: string;
  templateData: CampConversionLinkTemplateData;
}

export function buildCampConversionLinkEmailPayload(
  to: string,
  data: CampConversionLinkTemplateData,
): CampConversionLinkEmailPayload {
  return {
    to,
    subject: `Finish creating your PracticePerfect account with ${data.trainerBusinessName}`,
    templateData: data,
  };
}
