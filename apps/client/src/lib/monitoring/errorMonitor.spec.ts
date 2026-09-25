import { logClientError } from './errorMonitor';

// Task 18.3 — `logClientError`: the "client error monitor" fe §9.4 names as
// the sink for signals that should never happen in steady state (a
// `CHILD_CAPABILITY_DENIED`/`CHILD_FIELD_NOT_EDITABLE` reaching the client
// anyway, an ErrorBoundary catch). No error-tracking vendor is wired into
// this app — `console.error` keeps this a real, greppable signal rather than
// a silent no-op until one is.
describe('logClientError', () => {
  it('logs a namespaced, structured entry via console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    logClientError('child-capability-denied-reached-client', { path: '/me', errorCode: 'CHILD_FIELD_NOT_EDITABLE' });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('child-capability-denied-reached-client'),
      expect.objectContaining({ path: '/me', errorCode: 'CHILD_FIELD_NOT_EDITABLE' }),
    );

    spy.mockRestore();
  });
});
