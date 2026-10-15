import { expect } from '@playwright/test';

import type { ApiClient, ApiSession } from './api';
import { validPhone, type TrainerFixture } from './arrange';
import { strongPassword, uniqueEmail, uniqueName } from './ids';

/**
 * Arrange-by-API helpers for the player / parent / child side (Batch B specs). They create the family data a story
 * needs WITHOUT driving the UI, so the recorded video only shows the behaviour that is actually under test.
 */

export interface ProfileSummary {
  id: string;
  name: string;
  isSelf: boolean;
  trainerCount?: number;
}

export interface ParentFixture {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  userId: string;
  session: ApiSession;
  /** The player profiles that exist on the account (self first, if any). */
  profiles: ProfileSummary[];
}

export interface ChildLoginFixture {
  email: string;
  password: string;
  userId: string;
  profileId: string;
  name: string;
  session: ApiSession;
}

/** `YYYY-MM-DD` for someone who is `years` years (plus a few months) old today - safely inside the 1-18 child range. */
export function dobForAge(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - 3);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The trainer's static PLAYER ShareLink code (unlimited uses, no expiry). */
export async function createPlayerLinkCode(api: ApiClient, trainer: TrainerFixture): Promise<string> {
  const res = await api.post<{ code: string }>('/share-links', { auth: trainer.session, body: { type: 'PLAYER_STATIC' } });
  expect(res.status, `POST /share-links -> ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body.code;
}

export async function listProfiles(api: ApiClient, session: ApiSession): Promise<ProfileSummary[]> {
  const res = await api.get<ProfileSummary[]>('/player-profiles', { auth: session });
  expect(res.status, `GET /player-profiles -> ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

export interface RegisterOptions {
  /** `true` (default): the account holder trains too ("Me"); `false`: registers a child ("My child"). */
  isSelf?: boolean;
  playerName?: string;
  /** Age in years of the player (default 30 for self, 10 for a child). */
  age?: number;
}

/**
 * A brand new player/parent account registered through the trainer's static ShareLink (API `redeem`, anonymous branch).
 * `isSelf: false` creates a parent who is NOT a player themselves with one child profile.
 */
export async function registerParent(api: ApiClient, code: string, opts: RegisterOptions = {}): Promise<ParentFixture> {
  const isSelf = opts.isSelf ?? true;
  const { firstName, lastName } = uniqueName('Parent');
  const email = uniqueEmail('parent');
  const password = strongPassword();
  const playerName = opts.playerName ?? (isSelf ? `${firstName} ${lastName}` : `Kid ${lastName}`);
  const redeemed = await api.post(`/share-links/${encodeURIComponent(code)}/redeem`, {
    body: {
      parentFirstName: firstName,
      parentLastName: lastName,
      email,
      password,
      phone: validPhone(),
      playerName,
      dateOfBirth: dobForAge(opts.age ?? (isSelf ? 30 : 10)),
      gender: 'FEMALE',
      isSelf,
    },
  });
  expect(redeemed.status, `redeem -> ${JSON.stringify(redeemed.body)}`).toBeLessThan(300);
  const session = await api.login(email, password);
  const profiles = await listProfiles(api, session);
  return { email, password, firstName, lastName, userId: session.user.id, session, profiles };
}

/** Adds a child profile to the parent (API), optionally associating it with already-connected trainers. */
export async function addChildProfile(
  api: ApiClient,
  parent: Pick<ParentFixture, 'session'>,
  opts: { name?: string; age?: number; trainerIds?: string[]; school?: string } = {},
): Promise<ProfileSummary> {
  const name = opts.name ?? `Kid ${uniqueName('Kid').lastName}`;
  const res = await api.post<ProfileSummary>('/player-profiles', {
    auth: parent.session,
    body: { name, dateOfBirth: dobForAge(opts.age ?? 9), gender: 'MALE', school: opts.school, trainerIds: opts.trainerIds },
  });
  expect(res.status, `POST /player-profiles -> ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body;
}

/** A parent (self profile, "Me") with `childNames` children, everyone connected to `trainer` via its static link. */
export async function createParentWithChildren(
  api: ApiClient,
  trainer: TrainerFixture,
  childNames: string[],
  opts: { isSelf?: boolean } = {},
): Promise<ParentFixture & { children: ProfileSummary[]; code: string }> {
  const code = await createPlayerLinkCode(api, trainer);
  const isSelf = opts.isSelf ?? true;
  const parent = await registerParent(api, code, { isSelf });
  const children: ProfileSummary[] = [];
  for (const name of childNames) {
    children.push(await addChildProfile(api, parent, { name, trainerIds: [trainer.trainerId] }));
  }
  parent.profiles = await listProfiles(api, parent.session);
  return { ...parent, children, code };
}

/** Existing parent opens another trainer's link and picks which family members join (API twin of the family picker). */
export async function connectProfilesViaLink(api: ApiClient, parent: Pick<ParentFixture, 'session'>, code: string, profileIds: string[]): Promise<void> {
  const res = await api.post(`/share-links/${encodeURIComponent(code)}/redeem`, { auth: parent.session, body: { subjectProfileIds: profileIds } });
  expect(res.status, `associate -> ${JSON.stringify(res.body)}`).toBe(200);
}

/** The guardian gives a child profile its own sign-in (API twin of the "Child login" card). */
export async function createChildLogin(api: ApiClient, parent: Pick<ParentFixture, 'session'>, profile: ProfileSummary): Promise<ChildLoginFixture> {
  const email = uniqueEmail('child');
  const password = strongPassword();
  const res = await api.post<{ childUserId: string }>(`/player-profiles/${profile.id}/child-login`, { auth: parent.session, body: { email, password } });
  expect(res.status, `POST child-login -> ${JSON.stringify(res.body)}`).toBeLessThan(300);
  const session = await api.login(email, password);
  expect(session.user.accountType).toBe('CHILD');
  return { email, password, userId: res.body.childUserId, profileId: profile.id, name: profile.name, session };
}

export interface AvailabilitySlotInput {
  dayOfWeek: number;
  /** Minutes from midnight. */
  startTime: number;
  endTime: number;
  isAvailable?: boolean;
}

/** Replaces a player profile's Best Times (API twin of the availability grid). */
export async function setPlayerAvailability(api: ApiClient, session: ApiSession, profileId: string, slots: AvailabilitySlotInput[]): Promise<void> {
  const res = await api.put(`/player-profiles/${profileId}/availability`, {
    auth: session,
    body: { slots: slots.map((s) => ({ isAvailable: true, ...s })) },
  });
  expect(res.status, `PUT availability -> ${JSON.stringify(res.body)}`).toBeLessThan(300);
}

/** Minutes from midnight for an `HH:mm` clock time. */
export const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
