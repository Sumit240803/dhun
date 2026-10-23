// The new-user window's countdown.
//
// The deadline is the server's (`endsAt`, fixed at signup + 7 days) and the
// clock is the server's too, via the offset measured when the data arrived.
// Nothing here can lengthen the window: a reinstall, a changed phone clock or
// a return after a month all read the same `endsAt`.

import { useEffect, useState } from 'react';

// A type alias, not an interface, so it passes straight to t() as values.
export type Remaining = {
  d: number;
  h: number;
  m: number;
  s: number;
  /** Whole milliseconds left; 0 once the window has closed. */
  ms: number;
};

/** Pure: milliseconds into days, hours, minutes and seconds. Never negative. */
export function splitRemaining(ms: number): Remaining {
  const left = Math.max(0, Math.floor(ms));
  const total = Math.floor(left / 1000);
  return {
    d: Math.floor(total / 86_400),
    h: Math.floor((total % 86_400) / 3_600),
    m: Math.floor((total % 3_600) / 60),
    s: total % 60,
    ms: left,
  };
}

/** Ticks once a second while mounted. `null` endsAt means nothing to count. */
export function useCountdown(endsAt: string | null, clockOffsetMs: number): Remaining {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  return splitRemaining(endsAt ? Date.parse(endsAt) - (now + clockOffsetMs) : 0);
}
