'use client';

import { useSyncExternalStore } from 'react';
import { safeTimezone } from '@/lib/utils/timezone';

/**
 * When the snip was taken, in **the viewer's own timezone**.
 *
 * The page around this is a server component, and the server cannot know where
 * the visitor is — a public link can be opened by anyone, anywhere, with no
 * account and no stored preference. So the zone comes from the only place that
 * has it: `Intl.DateTimeFormat().resolvedOptions().timeZone` in their browser.
 *
 * **This is not the same source as the owner's library.** `SnipCard` formats in
 * the viewer's *account* timezone (`useViewerTimezone`), because there the
 * viewer is a signed-in employee whose zone is a known fact about them. Here
 * there is no account, so the browser is the authority. Same presentation, two
 * different sources of truth — don't collapse them.
 *
 * ## Why `useSyncExternalStore` and not an effect
 *
 * The server has to emit *something*, and whatever it emits must match the
 * client's first render or React reports a hydration mismatch — so the server
 * snapshot is UTC, which is deterministic on both sides, and the client
 * snapshot is the local zone. This is precisely the split
 * `useSyncExternalStore`'s third argument exists for, and React re-renders with
 * the client value immediately after hydrating.
 *
 * Reading the zone in a `useEffect` and calling `setState` would work, but it is
 * a state write in an effect (`react-hooks/set-state-in-effect`) — the hook
 * above expresses "this value differs between server and client" directly
 * instead of describing it as a state change. `suppressHydrationWarning` is the
 * other tempting option and is worse: it papers over the mismatch rather than
 * avoiding it, and silences genuine mismatches in the same subtree.
 */
export function SnipTimestamp({ iso }: { iso: string }) {
  const zone = useSyncExternalStore(subscribe, getBrowserZone, getServerZone);

  return (
    <time dateTime={iso} className="tabular-nums">
      {formatStamp(iso, zone)}
    </time>
  );
}

// The zone cannot change without a page load, so there is nothing to subscribe
// to. React still requires the function; returning a no-op unsubscribe is the
// documented shape for a store that never emits.
function subscribe(): () => void {
  return () => {};
}

/** Memoised because `getSnapshot` runs on every render and must be cheap and
 *  referentially stable; `resolvedOptions()` is neither. */
let browserZone: string | null = null;

function getBrowserZone(): string {
  if (browserZone === null) {
    // `resolvedOptions()` can throw in a locked-down environment, and has been
    // known to return an empty string in older engines — `safeTimezone` turns
    // either into UTC rather than letting `Intl` throw a RangeError when the
    // value is used below (rule 9g).
    try {
      browserZone = safeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      browserZone = 'UTC';
    }
  }
  return browserZone;
}

function getServerZone(): string {
  return 'UTC';
}

/**
 * `2026-09-20 16:32 GMT+2`.
 *
 * `en-CA` for the ISO-shaped date, `hour12: false` so it reads the same for
 * everyone, and `timeZoneName` because a bare wall-clock time on a link that
 * crosses timezones is worse than no time at all — the recipient cannot tell
 * whose afternoon it was. The comma `en-CA` inserts between date and time is
 * stripped to match the stamp on the owner's own library card.
 */
function formatStamp(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    })
      .format(new Date(iso))
      .replace(',', '');
  } catch {
    // A malformed stamp must not take the page down with it.
    return iso.slice(0, 16).replace('T', ' ');
  }
}
