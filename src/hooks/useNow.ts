'use client';

import { useEffect, useState } from 'react';

/**
 * `Date.now()`, refreshed whenever the window comes back into view.
 *
 * Not read during render, so output never depends on when React happened to
 * re-render — and this renderer stays open for weeks (rule 9c), so a clock
 * captured once at mount would go stale. Refreshing on focus is when the
 * person would next look.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return now;
}
