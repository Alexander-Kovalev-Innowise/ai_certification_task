import { ACTIVE_TRAINER_COOKIE, useTrainerContextStore } from './useTrainerContextStore';

function readRawCookie(name: string): string | undefined {
  return document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`))?.split('=')[1];
}

describe('useTrainerContextStore', () => {
  afterEach(() => {
    useTrainerContextStore.getState().setActiveTrainerId(null);
    document.cookie = `${ACTIVE_TRAINER_COOKIE}=; path=/; max-age=0`;
  });

  it('starts with no active trainer context', () => {
    expect(useTrainerContextStore.getState().activeTrainerId).toBeNull();
  });

  // fe §5.2/§6.3 — backed by a non-httpOnly cookie for SSR-readability, in
  // addition to the in-memory Zustand field.
  it('setActiveTrainerId writes both the store field and a readable cookie', () => {
    useTrainerContextStore.getState().setActiveTrainerId('trainer-42');

    expect(useTrainerContextStore.getState().activeTrainerId).toBe('trainer-42');
    expect(readRawCookie(ACTIVE_TRAINER_COOKIE)).toBe('trainer-42');
  });

  it('setActiveTrainerId(null) clears both the store field and the cookie', () => {
    useTrainerContextStore.getState().setActiveTrainerId('trainer-42');
    useTrainerContextStore.getState().setActiveTrainerId(null);

    expect(useTrainerContextStore.getState().activeTrainerId).toBeNull();
    expect(readRawCookie(ACTIVE_TRAINER_COOKIE)).toBeUndefined();
  });
});
