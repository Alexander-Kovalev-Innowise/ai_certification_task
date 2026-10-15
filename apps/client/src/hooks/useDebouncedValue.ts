import { useEffect, useState } from 'react';

// Returns `value` only after it has stopped changing for `delayMs`. The first
// render returns `value` immediately (no initial delay). Pass objects freely:
// the returned reference is the exact one that was current when the timer
// fired, so it only changes identity after a quiet period.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
