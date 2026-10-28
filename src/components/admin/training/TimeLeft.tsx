'use client';

import { useLayoutEffect, useRef } from 'react';
import { formatDuration } from './zonedTime';

/**
 * A candidate's remaining time, ticking — `12m 04s`. Judged on the server's
 * clock (`skewMs` = server − device at the last read), so a wrong admin clock
 * shows the same figure the candidate sees.
 *
 * The figure is written straight to the DOM once a second rather than through
 * state: a 1 Hz React update anywhere in the tree interrupts pending
 * navigations (CLAUDE.md, the sidebar hang). It stops at zero; the next read
 * flips the state.
 */
export function TimeLeft({ deadlineMs, skewMs }: { deadlineMs: number; skewMs: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const paint = () => {
      if (ref.current) ref.current.textContent = formatDuration(deadlineMs - (Date.now() + skewMs));
    };
    paint();
    const id = window.setInterval(paint, 1000);
    return () => window.clearInterval(id);
  }, [deadlineMs, skewMs]);

  return <span ref={ref} className="tabular-nums" />;
}
