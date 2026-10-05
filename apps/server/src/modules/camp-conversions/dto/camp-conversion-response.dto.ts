import type { CampGender, CampSource } from './create-camp-conversion.dto';

export interface CampConversionCreatedDto {
  conversionToken: string;
  expiresAt: Date;
  joinUrl: string;
}

export interface CampConversionPrefillDto {
  shareLinkCode: string;
  source: CampSource;
  expiresAt: Date;
  trainer: { displayName: string; logoUrl: string | null; primaryColorHex: string | null };
  prefill: {
    parentFirstName: string;
    parentLastName: string;
    email: string;
    phone: string;
    playerName: string;
    playerAge: number;
    /** Approximate (mid-year) date of birth consistent with `playerAge`, `YYYY-MM-DD`. */
    dateOfBirth: string;
    gender: CampGender;
    /** `true` when the player is an adult (registering for themselves); `false` => parent account + child profile. */
    isSelf: boolean;
  };
}
