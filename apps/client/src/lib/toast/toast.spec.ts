import { useToastStore } from '../../stores/useToastStore';

import { AUTO_DISMISS_MS, toast } from './toast';

// Task 18.3 — the toast system's actual resolution point. Every prior
// frontend phase (11-17) used inline `role="alert"`/`role="status"` text as
// an explicit stopgap for exactly this ("no toast library exists in this
// codebase" — Phase 11's own comments). This is a small, hand-rolled
// primitive: no new dependency, matching this codebase's established
// preference (Phase 12 hand-rolled virtualization rather than adding a
// library) and the ~3-method API this app actually needs (`toast.success/
// error/info`) — pulling in a full toast library for that would be the
// opposite of "focused." See the Phase 18 wrap-up report for the full
// reasoning and the explicit scope boundary (this task does NOT retrofit
// Phases 11-17's existing inline role="alert" usages).
describe('toast', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('toast.success/error/info each push a toast of the matching variant', () => {
    toast.success('Saved.');
    toast.error('Failed.');
    toast.info('FYI.');

    const messages = useToastStore.getState().toasts.map((t) => [t.variant, t.message]);
    expect(messages).toEqual([
      ['success', 'Saved.'],
      ['error', 'Failed.'],
      ['info', 'FYI.'],
    ]);
  });

  it('auto-dismisses a toast after AUTO_DISMISS_MS', () => {
    toast.info('Auto-dismiss me');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    jest.advanceTimersByTime(AUTO_DISMISS_MS);

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('returns the id so a caller could dismiss it early if needed', () => {
    const id = toast.success('Saved.');
    expect(useToastStore.getState().toasts[0]?.id).toBe(id);
  });
});
