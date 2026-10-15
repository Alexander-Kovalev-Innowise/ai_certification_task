import { useToastStore } from './useToastStore';

// Task 18.3 — `useToastStore`: the client-only state backing `toast.ts`.
// Zustand, not Context, same fe §6.1/§6.3 reasoning every other
// genuinely-client-only piece of state in this app already uses.
describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('push() appends a toast and returns its id', () => {
    const id = useToastStore.getState().push('success', 'Saved.');

    expect(useToastStore.getState().toasts).toEqual([{ id, variant: 'success', message: 'Saved.' }]);
  });

  it('dismiss() removes only the matching toast', () => {
    const firstId = useToastStore.getState().push('info', 'First');
    useToastStore.getState().push('error', 'Second');

    useToastStore.getState().dismiss(firstId);

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe('Second');
  });

  it('assigns each toast a unique id', () => {
    const id1 = useToastStore.getState().push('info', 'a');
    const id2 = useToastStore.getState().push('info', 'b');

    expect(id1).not.toBe(id2);
  });
});
