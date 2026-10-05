import { calculateAge } from '../player-profiles/age.util';

import { approximateDateOfBirth, toPrefill } from './camp-conversion.payload';
import type { CampConversionPayload } from './camp-conversion.payload';

const payload: CampConversionPayload = {
  parentFirstName: 'Pat',
  parentLastName: 'Camper',
  email: 'pat@example.com',
  phone: '+14155552671',
  playerName: 'Kid Camper',
  playerAge: 10,
  playerGender: 'FEMALE',
  source: 'CAMP',
};

describe('approximateDateOfBirth', () => {
  it.each([1, 9, 10, 17, 18, 40, 99])('keeps the computed age equal to %i', (age) => {
    const now = new Date('2026-10-05T12:00:00Z');
    const dob = new Date(approximateDateOfBirth(age, now));
    expect(calculateAge(dob, now)).toBe(age);
  });

  it('also holds on a leap day', () => {
    const now = new Date('2028-02-29T12:00:00Z');
    expect(calculateAge(new Date(approximateDateOfBirth(12, now)), now)).toBe(12);
  });
});

describe('toPrefill', () => {
  it('treats under-18 as a child (isSelf false) and 18+ as the player themselves', () => {
    expect(toPrefill({ ...payload, playerAge: 17 }).isSelf).toBe(false);
    expect(toPrefill({ ...payload, playerAge: 18 }).isSelf).toBe(true);
  });

  it('exposes only contact/player data', () => {
    expect(Object.keys(toPrefill(payload)).sort()).toEqual(
      ['dateOfBirth', 'email', 'gender', 'isSelf', 'parentFirstName', 'parentLastName', 'phone', 'playerAge', 'playerName'].sort(),
    );
  });
});
