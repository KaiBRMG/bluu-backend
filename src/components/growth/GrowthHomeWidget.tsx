'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { usePinnedGrowthAccounts } from '@/hooks/usePinnedGrowthAccounts';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { STATUS_HEX } from '@/lib/campaignTracking';
import {
  STOPPED_SUMMARY, deltaFor, formatCompact, formatCount, rangeStart, readProblemOf, sparklineFor,
} from '@/lib/growth/metrics';
import type { PinnedGrowthAccount } from '@/types/firestore';
import { AccountAvatar, DeltaValue, PlatformIcon, ReadProblemBadge } from './growthUi';
import { Sparkline } from './Sparkline';

const GROWTH_HREF = '/smm-portal/growth-tracking';

/**
 * The Growth Tracking home widget — the accounts a person starred, as compact
 * copies of their overview cards.
 *
 * ── What it is a copy *of* ──────────────────────────────────────────────────
 * `AccountCard`'s three bands, in the same order and with the same colour rules:
 * identity with its state marks, then the follower figure with its change, then
 * a sparkline on the account's own scale. Compressed rather than redesigned, so
 * a reader who knows the overview reads this without learning anything new: the
 * figure steps down from Display to 16px, the sparkline from 36px to 24px, the
 * category line is dropped (the handle already identifies the account on a
 * surface this small), and the card becomes a row on the overlay's list-item
 * step inside the widget's own card — never a bordered card inside a card.
 *
 * **One fixed window: 30 days.** The overview's range control lives on the
 * overview; a home widget with its own picker would be a second copy of that
 * page. Thirty days is the page's default, so the widget and the grid agree on
 * first sight. The header says so, because a delta without its window is not a
 * number anyone can use.
 *
 * ── Each row is a link, not a button ────────────────────────────────────────
 * It goes somewhere — the Growth Tracking page with that account's panel open
 * (`?account=<id>`, read once by the page) — so it is an `<a>`, which also means
 * `NavigationWatchdog` sees the click. `prefetch={false}` per rule 9i: five
 * links on a page someone leaves open all day would otherwise re-prefetch the
 * whole Growth Tracking route on every `staleTimes` expiry.
 *
 * ── Data ────────────────────────────────────────────────────────────────────
 * `/api/smm/growth/pinned` returns only the pinned accounts and their last 30
 * days, projected to the follower count. The fetch is keyed on the pin ids *as a
 * string*, never on the user-doc snapshot (rule 9i): presence rewrites that doc
 * every ten minutes, and keying on the object would turn this into a poll. The
 * ids are in the URL, so the browser's 15-minute cache answers repeat visits.
 */
export function GrowthHomeWidget() {
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const { pinned, max } = usePinnedGrowthAccounts();

  // Content-compared: a new array with the same ids is not a reason to fetch.
  const key = pinned.join(',');

  // The last successful load, tagged with the pins it was for, and the pin set
  // whose load failed. Everything else — loading, error, pending rows — is
  // derived from these two against the current `key`.
  const [data, setData] = useState<{ key: string; accounts: PinnedGrowthAccount[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user || key === '') return;
    let cancelled = false;
    authFetch(`/api/smm/growth/pinned?ids=${encodeURIComponent(key)}`)
      .then((res: { accounts: PinnedGrowthAccount[] }) => {
        if (cancelled) return;
        setData({ key, accounts: res.accounts });
        setFailedKey(null);
      })
      .catch(() => { if (!cancelled) setFailedKey(key); });
    return () => { cancelled = true; };
  }, [user, key, authFetch, attempt]);

  const retry = useCallback(() => {
    setFailedKey(null);
    setAttempt((n) => n + 1);
  }, []);

  const error = key !== '' && failedKey === key;
  /** The rows on screen do not yet describe the current pins. */
  const loading = key !== '' && data?.key !== key && !error;
  // Only the first load holds the boot screen (rule 8); a pin added later shows
  // its own skeleton row while the previous rows stay on screen.
  useBootPhase('home-growth', loading && data === null);

  /** Rows in pin order, from the last load, dropping any unpinned since. */
  const rows = useMemo(() => {
    const byId = new Map((data?.accounts ?? []).map((a) => [a.id, a]));
    const from = rangeStart('30d');
    return pinned
      .map((id) => byId.get(id))
      .filter((a): a is PinnedGrowthAccount => !!a)
      .map((account) => ({
        account,
        delta: deltaFor(account.days, from),
        points: sparklineFor(account.days, from),
      }));
  }, [data, pinned]);

  const pendingRows = loading ? pinned.length - rows.length : 0;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2">
          Growth Tracking
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About this widget"
                // 24px target (WCAG 2.5.8) that still sits in a 16px slot beside
                // the label: the negative margin gives back what the size adds.
                className="-m-1 inline-flex size-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[16rem]">
              Star up to {max} accounts on Growth Tracking to follow them here. Figures are the
              change over the last 30 days.
            </TooltipContent>
          </Tooltip>
          {rows.length > 0 && (
            <span className="ml-auto text-[11px] font-normal text-zinc-400">30 days</span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-4">
        {error && rows.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Could not load your pinned accounts.{' '}
            <Button variant="link" size="xs" className="h-auto p-0 text-zinc-300" onClick={retry}>
              Try again
            </Button>
          </p>
        ) : !loading && rows.length === 0 ? (
          // One quiet line, with the way in (DESIGN.md § Loading & Empty).
          <p className="text-sm text-zinc-400">
            Nothing pinned yet. Star an account on{' '}
            <Link
              href={GROWTH_HREF}
              prefetch={false}
              className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
            >
              Growth Tracking
            </Link>{' '}
            to follow it here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map(({ account, delta, points }) => (
              <li key={account.id}>
                <PinnedRow account={account} delta={delta} points={points} />
              </li>
            ))}
            {Array.from({ length: pendingRows }).map((_, i) => (
              // The height of a real row (10px padding × 2, the 28px identity
              // line, an 8px gap, the 24px line), so nothing jumps on arrival.
              <li key={`pending-${i}`} aria-hidden>
                <Skeleton className="h-20 w-full rounded-lg" />
              </li>
            ))}
            {/* A pin added since the last load that could not be fetched. The
                rows above are still true, so they stay; the missing one is said
                rather than silently absent. */}
            {error && (
              <li className="text-[11px] text-zinc-400">
                {pinned.length - rows.length === 1
                  ? 'One pinned account could not be loaded.'
                  : `${pinned.length - rows.length} pinned accounts could not be loaded.`}{' '}
                <Button variant="link" size="xs" className="h-auto p-0 text-[11px] text-zinc-300" onClick={retry}>
                  Try again
                </Button>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PinnedRow({
  account,
  delta,
  points,
}: {
  account: PinnedGrowthAccount;
  delta: ReturnType<typeof deltaFor>;
  points: ReturnType<typeof sparklineFor>;
}) {
  const rising = delta.change !== null && delta.change > 0;
  const falling = delta.change !== null && delta.change < 0;

  return (
    <Link
      href={`${GROWTH_HREF}?account=${encodeURIComponent(account.id)}`}
      prefetch={false}
      title={delta.last === null ? undefined : `@${account.handle} · ${formatCount(delta.last)} followers`}
      // One sentence, not the row's text run together: read as-is it would
      // include the Stopped badge's whole explanation on every row.
      aria-label={rowLabel(account, delta)}
      // The list-item step of the overlay recipe (DESIGN.md §4) — 0.04 resting
      // on the card, 0.055 hover, 0.08 pressed, as the compact dispute rows do —
      // and the house focus ring from `--ring`, inset so the rounding cannot
      // clip it (DESIGN.md § Interaction).
      className="flex flex-col gap-2 rounded-lg bg-white/[0.04] px-3 py-2.5
        transition-colors duration-[120ms] ease-out
        hover:bg-white/[0.055] active:bg-white/[0.08]
        focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-2.5">
        <AccountAvatar account={account} className="size-7 rounded-[7px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <PlatformIcon platform={account.platform} className="size-3" />
            <span className="truncate text-sm font-medium text-white">{account.handle}</span>
          </span>
          {/* The state line: said only when there is something to say. */}
          {account.isActive
            ? <ReadProblemBadge item={account} subject="account" className="w-fit" />
            : <span className="text-[11px] text-zinc-400">Not tracked</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-base font-semibold leading-tight tabular-nums text-white">
            {delta.last === null ? '—' : formatCompact(delta.last)}
          </span>
          <DeltaValue delta={delta} showPercent={false} className="text-[11px] font-medium" />
        </span>
      </span>
      <Sparkline
        points={points}
        width={480}
        height={24}
        stroke={rising ? STATUS_HEX.green : falling ? STATUS_HEX.red : undefined}
        className="w-full"
      />
    </Link>
  );
}

/** "@handle, 12,340 followers, up 210 in 30 days, Stopped" — a row's name. */
function rowLabel(account: PinnedGrowthAccount, delta: ReturnType<typeof deltaFor>): string {
  const parts = [`@${account.handle}`];
  parts.push(delta.last === null ? 'no reading yet' : `${formatCount(delta.last)} followers`);
  if (delta.change !== null) {
    parts.push(delta.change === 0
      ? 'unchanged in 30 days'
      : `${delta.change > 0 ? 'up' : 'down'} ${formatCount(Math.abs(delta.change))} in 30 days`);
  }
  const problem = readProblemOf(account);
  if (!account.isActive) parts.push('not tracked');
  else if (problem === 'stopped') parts.push(STOPPED_SUMMARY.toLowerCase());
  else if (problem === 'failed') parts.push('last read failed');
  return parts.join(', ');
}
