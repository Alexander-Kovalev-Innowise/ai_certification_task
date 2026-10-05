import { ADULT_AGE } from '../player-profiles/age.util';

import type { CampConversionPrefillDto } from './dto/camp-conversion-response.dto';
import type { CampGender, CampSource } from './dto/create-camp-conversion.dto';

/** What is persisted in `CampConversion.payload` - contact/player data only, never secrets. */
export interface CampConversionPayload {
  parentFirstName: string;
  parentLastName: string;
  email: string;
  phone: string;
  playerName: string;
  playerAge: number;
  playerGender: CampGender;
  source: CampSource;
  submissionRef?: string;
}

const HALF_YEAR_DAYS = 182;

/**
 * A camp form collects an age, the account needs a date of birth: pick a date half a year past the (unknown)
 * birthday so the computed age stays equal to `age` for the next ~6 months and is never off by a year at sign-up.
 */
export function approximateDateOfBirth(age: number, now: Date = new Date()): string {
  const dob = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  dob.setUTCDate(dob.getUTCDate() - HALF_YEAR_DAYS);
  return dob.toISOString().slice(0, 10);
}

export function toPrefill(payload: CampConversionPayload, now: Date = new Date()): CampConversionPrefillDto['prefill'] {
  return {
    parentFirstName: payload.parentFirstName,
    parentLastName: payload.parentLastName,
    email: payload.email,
    phone: payload.phone,
    playerName: payload.playerName,
    playerAge: payload.playerAge,
    dateOfBirth: approximateDateOfBirth(payload.playerAge, now),
    gender: payload.playerGender,
    isSelf: payload.playerAge >= ADULT_AGE,
  };
}
