import type { UserSummaryDto } from '../types/auth';

import { useAuthStore } from './useAuthStore';

const testUser: UserSummaryDto = {
  id: 'user-1',
  email: 'trainer@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Test',
  lastName: 'Trainer',
  mustChangePassword: false,
};

describe('useAuthStore', () => {
  afterEach(() => {
    useAuthStore.getState().clear();
    jest.restoreAllMocks();
  });

  it('starts with a null/false initial state', () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.isImpersonating).toBe(false);
  });

  it('setSession populates every field, defaulting isImpersonating to false', () => {
    useAuthStore.getState().setSession({ accessToken: 'token-123', user: testUser, expiresAt: 999 });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('token-123');
    expect(state.user).toEqual(testUser);
    expect(state.expiresAt).toBe(999);
    expect(state.isImpersonating).toBe(false);
  });

  it('setSession honors an explicit isImpersonating: true', () => {
    useAuthStore.getState().setSession({ accessToken: 'imp-token', user: testUser, expiresAt: 999, isImpersonating: true });

    expect(useAuthStore.getState().isImpersonating).toBe(true);
  });

  it('clear() resets every field back to the initial state', () => {
    useAuthStore.getState().setSession({ accessToken: 'token-123', user: testUser, expiresAt: 999, isImpersonating: true });

    useAuthStore.getState().clear();

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      expiresAt: null,
      isImpersonating: false,
    });
  });

  // arch §6.1 — persisting the access token to any browser storage is
  // exactly the XSS exposure this store exists to avoid. Asserted via a spy
  // on the shared Storage.prototype (covers both localStorage and
  // sessionStorage, since both implement the same interface) rather than
  // just checking `.length === 0`, so the assertion fails loudly if a
  // `zustand/persist` middleware — or any other write — is ever added.
  it('never writes to window.localStorage or window.sessionStorage', () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

    useAuthStore.getState().setSession({ accessToken: 'token-123', user: testUser, expiresAt: 999, isImpersonating: true });
    useAuthStore.getState().clear();

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
