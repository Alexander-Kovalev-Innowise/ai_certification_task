import type { Gender } from '../../lib/schemas/anonymousJoinSchema';

// GET /camp-conversions/:token — the camp/evaluation sign-up data used to pre-fill the registration form.
export interface CampPrefillResponse {
  shareLinkCode: string;
  source: 'CAMP' | 'EVALUATION';
  expiresAt: string;
  trainer: { displayName: string; logoUrl: string | null; primaryColorHex: string | null };
  prefill: {
    parentFirstName: string;
    parentLastName: string;
    email: string;
    phone: string;
    playerName: string;
    playerAge: number;
    /** `YYYY-MM-DD`, approximate (the camp form only collected an age). */
    dateOfBirth: string;
    gender: Gender;
    isSelf: boolean;
  };
}

export type CampPrefill = CampPrefillResponse['prefill'];
