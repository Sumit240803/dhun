import { useEffect, useState } from 'react';

/**
 * A value that only settles after it has stopped changing for `delayMs`.
 *
 * For search-as-you-type: without it, typing "priyanka" is eight requests, and
 * the results flicker through seven queries nobody asked for.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
