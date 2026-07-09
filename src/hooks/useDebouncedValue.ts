'use client';

import { useEffect, useState } from 'react';

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delayMs`. Use it to keep a controlled input responsive while deferring
 * expensive work (filtering, fetching) until the user pauses typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
