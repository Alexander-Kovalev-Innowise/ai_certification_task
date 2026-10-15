import { act, renderHook } from '@testing-library/react';

import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300));
    expect(result.current).toBe('a');
  });

  it('only updates after the delay has elapsed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 'a' } });

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });

  it('restarts the timer on rapid successive changes and emits only the last value', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 'a' } });

    rerender({ value: 'b' });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender({ value: 'c' });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current).toBe('c');
  });

  it('defaults to a 300ms delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), { initialProps: { value: 1 } });

    rerender({ value: 2 });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current).toBe(2);
  });

  it('keeps the exact object reference that was current when the timer fired', () => {
    const first = { q: 'a' };
    const second = { q: 'ab' };
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: first } });

    rerender({ value: second });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current).toBe(second);
  });

  it('does not fire after unmount', () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 'a' } });
    rerender({ value: 'b' });
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
