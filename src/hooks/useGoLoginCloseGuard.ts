'use client';

import { useCallback, useEffect, useState } from 'react';

export type CloseDecision = 'cancel' | 'force' | 'after-completion' | 'stop-and-close';

/**
 * The guard that stops the GoLogin window closing over live work.
 *
 * Two situations trigger it, and they are genuinely different:
 *
 * - **A profile is still saving** (`stopping`). `gl.stop()` is uploading the
 *   profile's cookies and local state. Interrupt it and the operator's session
 *   work is gone — they log into an account, close the browser, and are logged
 *   out again next time.
 * - **A profile is still open** (`starting`/`running`). Closing the window does
 *   *not* close Orbita, so the operator ends up with a browser nothing in Bluu
 *   is showing them, and the profile stays locked to their machine until they
 *   quit the app or reopen the window.
 *
 * Neither is a mistake the operator can see coming, which is why main holds the
 * window and asks rather than letting it go.
 */
export function useGoLoginCloseGuard() {
  const api = typeof window !== 'undefined' ? window.electronAPI?.gologin : undefined;
  const supported = !!api?.onCloseBlocked;

  /** Non-null once main has blocked a close and is waiting for an answer. */
  const [blocked, setBlocked] = useState<boolean>(false);
  /** True once the operator picked an option that ends in the window closing. */
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!api?.onCloseBlocked) return;
    let alive = true;

    api.onCloseBlocked(() => {
      if (!alive) return;
      // The payload lists what was busy at the moment of the click, but the page
      // renders from the live session map instead — a list captured once would
      // stop counting down as each profile finishes.
      setBlocked(true);
    });

    return () => {
      alive = false;
      // `removeAllListeners` on the channel — safe only because this hook is
      // mounted once per window, the same rule as every other GoLogin channel.
      api.removeCloseBlockedListeners?.();
    };
  }, [api]);

  const decide = useCallback(
    async (decision: CloseDecision) => {
      if (!api?.closeDecision) return;
      // Both closing choices keep the dialog up: the window is still open, work
      // is still in flight, and dismissing would look like it had finished.
      const willClose = decision === 'after-completion' || decision === 'stop-and-close';
      setClosing(willClose);
      if (!willClose) setBlocked(false);
      await api.closeDecision(decision);
    },
    [api],
  );

  /**
   * Called when the live session map shows nothing busy any more. Main closes
   * the window itself in the `closing` case; this only clears the dialog for the
   * operator who chose Cancel and is still watching.
   */
  const clearIfIdle = useCallback((stillBusy: boolean) => {
    if (stillBusy) return;
    setBlocked(false);
    setClosing(false);
  }, []);

  return { supported, blocked, closing, decide, clearIfIdle };
}
