'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCcw, Search, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { useGoLoginProfiles } from '@/hooks/useGoLoginProfiles';
import { useGoLoginSessions } from '@/hooks/useGoLoginSessions';
import type { GoLoginSession } from '@/types/electron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { GoLoginProfile } from '@/lib/gologin/types';

/**
 * How many rows are rendered at a time.
 *
 * Every profile is already in memory — the provider's list is fetched whole (see
 * gologin.md § The rate limit is the whole design), so this window is about DOM
 * cost, not network. A workspace of a thousand profiles is a thousand rows the
 * browser lays out for a reader who will look at twenty.
 */
const PAGE_SIZE = 30;

/**
 * GoLogin — the browser-profile console.
 *
 * Scope of this iteration is one job: **display every profile**. Launching,
 * editing and creating profiles are all provider writes and are deliberately not
 * here; the adapter seam in `src/lib/gologin` is where they would land.
 *
 * A single pane, so it reuses the satellite shell's chrome (eyebrow section
 * title, hairline rules, the overlay recipe, filter chips) rather than its
 * two-pane layout — there is no second pane to justify one. See DESIGN.md § The
 * satellite-window shell.
 */
export default function GoLoginPage() {
  const { isOnline } = useNetworkStatus();
  const {
    sessions,
    supported: sessionsSupported,
    launch: launchSession,
    stop: stopSession,
  } = useGoLoginSessions();
  const { profiles, total, truncated, fetchedAtMs, loading, refreshing, error, refresh } =
    useGoLoginProfiles();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);

  // Search first, folder second — the split is what lets the folder counts below
  // be faceted (each count is measured with the folder filter cleared, so the
  // number beside a chip is what clicking it actually produces).
  const searchMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((p) =>
      [p.name, p.notes, p.proxyRegion, p.os, ...p.folders]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [profiles, query]);

  const folderFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of searchMatches) {
      for (const name of profile.folders) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [searchMatches]);

  // A folder that disappears (the search narrowed past it, or a refresh removed
  // it) must not leave the list filtered by something with no chip left to
  // unset — so the selection is *derived* rather than corrected in an effect.
  const activeFolder =
    folder && folderFacets.some(([name]) => name === folder) ? folder : null;

  const filtered = useMemo(
    () =>
      activeFolder ? searchMatches.filter((p) => p.folders.includes(activeFolder)) : searchMatches,
    [searchMatches, activeFolder],
  );

  // Any change to *what is being listed* starts the window over. Adjusted
  // during render against a key rather than in an effect: an effect would paint
  // one frame of the previous window's row count first, and `setState` in an
  // effect body is a cascading render (react-hooks/set-state-in-effect).
  const listKey = `${query}\u0000${activeFolder ?? ''}\u0000${fetchedAtMs ?? ''}`;
  const [windowKey, setWindowKey] = useState(listKey);
  if (windowKey !== listKey) {
    setWindowKey(listKey);
    setShown(PAGE_SIZE);
  }

  const visible = filtered.slice(0, shown);
  const hasMore = filtered.length > visible.length;

  // The next page is already in memory, so it arrives in the same frame — the
  // sentinel is a bare hairline and the count line below carries the state. A
  // spinner here would be theatre for work that isn't happening (DESIGN.md § 5).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown((n) => n + PAGE_SIZE);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, visible.length]);

  const isFiltered = !!query.trim() || !!activeFolder;

  const clearFilters = () => {
    setQuery('');
    setFolder(null);
  };

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="shrink-0 border-b border-white/[0.07] px-6 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            {/* The eyebrow is the only place the window names itself — the same
                device the sidebar uses for its section headers. */}
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
              GoLogin
            </h2>
            <h1 className="text-2xl font-bold tracking-tight text-white">Profiles</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing || loading || !isOnline}
          >
            <RefreshCcw className={refreshing ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search profiles"
            aria-label="Search profiles"
            className="border-zinc-700 bg-zinc-800 pl-9"
          />
        </div>

        {/* Folders as filter chips. A profile carries its folders as an open set
            of names, so they are the one grouping this surface actually has —
            and a chip row directly under the search reads as "narrow what you
            just typed", which is what it does. */}
        {folderFacets.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <FolderChip
              label="All"
              count={searchMatches.length}
              selected={activeFolder === null}
              onSelect={() => setFolder(null)}
            />
            {folderFacets.map(([name, count]) => (
              <FolderChip
                key={name}
                label={name}
                count={count}
                selected={activeFolder === name}
                onSelect={() => setFolder(activeFolder === name ? null : name)}
              />
            ))}
          </div>
        )}

        <p className="mt-2 text-[11px] text-zinc-400">
          {loading ? (
            'Loading…'
          ) : (
            <>
              {hasMore ? (
                <>
                  {'Showing '}
                  <span className="tabular-nums">{visible.length}</span>
                  {' of '}
                  <span className="tabular-nums">{filtered.length}</span>
                </>
              ) : (
                <>
                  <span className="tabular-nums">{filtered.length}</span>
                  {` profile${filtered.length === 1 ? '' : 's'}`}
                </>
              )}
              {isFiltered && filtered.length !== profiles.length && (
                <>
                  {' · '}
                  <span className="tabular-nums">{profiles.length}</span>
                  {' in total'}
                </>
              )}
              {truncated && (
                <>
                  {' · the workspace has '}
                  <span className="tabular-nums">{total}</span>
                  {', showing the first '}
                  <span className="tabular-nums">{profiles.length}</span>
                </>
              )}
            </>
          )}
        </p>

        {/* Offline is a condition, not an error — zinc, in place, no toast. */}
        {!isOnline && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <WifiOff className="size-3.5" aria-hidden />
            Offline — showing the last loaded profiles.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2">
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          // Persistent state, rendered inline with a way out — not a toast that
          // reports the same fact and then vanishes.
          <div className="flex flex-col items-start gap-2 py-8">
            <p className="text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          // "Empty because of a filter" is a dead end and must carry its own way
          // out; "empty because there is nothing" is just a fact.
          isFiltered ? (
            <p className="py-8 text-sm text-zinc-400">
              Nothing matches these filters.{' '}
              <button
                type="button"
                onClick={clearFilters}
                className="underline underline-offset-2 hover:text-white"
              >
                Clear them
              </button>{' '}
              to see all <span className="tabular-nums">{profiles.length}</span>.
            </p>
          ) : (
            <p className="py-8 text-sm text-zinc-400">No profiles in this workspace yet.</p>
          )
        ) : (
          <>
            <ul className="divide-y divide-white/[0.07]">
              {visible.map((profile) => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  session={sessions[profile.id]}
                  canLaunch={sessionsSupported}
                  onLaunch={launchSession}
                  onStop={stopSession}
                />
              ))}
            </ul>
            {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A filter chip, per the satellite shell: `rounded-full`, the selected one
 * **filled** Action Blue Deep with white ink (white on `#3b82f6` measures 3.68:1
 * and fails AA — tint at `#3b82f6`, fill at `#2563eb`), the rest riding the
 * hover/active overlay recipe. `aria-pressed` carries the state.
 */
function FolderChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        selected
          ? 'bg-[#2563eb] text-white'
          : 'bg-white/[0.04] text-zinc-400 hover:bg-white/[0.055] hover:text-white active:bg-white/[0.08]'
      }`}
    >
      {label} <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}

/**
 * Running / Idle is a **closed two-value vocabulary**, so it earns a hue — but
 * the hues are borrowed from `STATUS_COLORS`' triad (green = active, zinc =
 * neutral) rather than invented, exactly as `disputeStatus.ts` borrows them for
 * its own derived states. `STATUS_COLORS` itself is keyed by `CRStatus` and has
 * no member that means this.
 */
const RUNNING_DOT = 'bg-green-400';
const IDLE_DOT = 'bg-zinc-500';

const OS_LABELS: Record<string, string> = {
  win: 'Windows',
  mac: 'macOS',
  lin: 'Linux',
  android: 'Android',
};

function relativeTime(msSince: number | null): string | null {
  if (!msSince) return null;
  const diff = Date.now() - msSince;
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(msSince).toLocaleDateString();
}

function ProfileRow({
  profile,
  session,
  canLaunch,
  onLaunch,
  onStop,
}: {
  profile: GoLoginProfile;
  session?: GoLoginSession;
  canLaunch: boolean;
  onLaunch: (profileId: string) => Promise<boolean>;
  onStop: (profileId: string) => Promise<boolean>;
}) {
  // The row itself is still not a target — its Launch button is. So the row
  // carries no hover fill: a row that lights up under the cursor promises that
  // clicking anywhere in it does something, and here it doesn't. The action is
  // always visible rather than revealed on hover, because launching a profile is
  // now this page's whole job (the decision-queue rule, not the index one).
  const meta: string[] = [];
  const os = OS_LABELS[profile.os] ?? profile.os;
  if (os) meta.push(os);
  if (profile.proxyType && profile.proxyType !== 'none') {
    meta.push(profile.proxyRegion ? `${profile.proxyType} · ${profile.proxyRegion}` : profile.proxyType);
  } else {
    meta.push('No proxy');
  }
  const seen = relativeTime(profile.lastActivityMs);
  if (seen) meta.push(`Active ${seen}`);

  const status = session?.status ?? 'idle';
  // Two different facts that both read as "running", kept apart on purpose:
  // `session` is a browser open on THIS machine, which we can open and stop;
  // `profile.isRunning` is the provider saying it is open somewhere — possibly a
  // colleague's desk — and launching over that is what GoLogin rejects.
  const liveHere = status === 'running';
  const liveElsewhere = profile.isRunning && !liveHere;

  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${liveHere || profile.isRunning ? RUNNING_DOT : IDLE_DOT}`}
            aria-hidden
          />
          <span className="truncate text-sm font-medium text-white">
            {profile.name || 'Untitled profile'}
          </span>
          {liveHere && (
            <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-400">
              Open here
            </span>
          )}
          {liveElsewhere && (
            <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
              {profile.runningUserEmail ? `In use · ${profile.runningUserEmail}` : 'In use elsewhere'}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">
          {meta.map((item, i) => (
            <span key={item}>
              {i > 0 && <span aria-hidden> · </span>}
              {item}
            </span>
          ))}
        </p>
        {profile.notes && (
          <p className="mt-1 max-w-[70ch] truncate text-[11px] text-zinc-400">{profile.notes}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* The row keeps its folders as attribute chips — greyscale, because a
            folder is a label the profile carries, not a state it is in. The
            filter row above is where they become interactive. */}
        {profile.folders.map((name) => (
          <span
            key={name}
            className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300"
          >
            {name}
          </span>
        ))}
        <span className="font-mono text-xs text-zinc-400">{profile.id.slice(-6)}</span>
        {/* The action lane. Always visible rather than revealed on hover,
            because launching is now this page's whole job — the decision-queue
            rule, not the faceted-index one. */}
        {canLaunch && (
          <div className="flex items-center gap-1.5">
            {status === 'starting' || status === 'stopping' ? (
              <span className="flex items-center gap-1.5 px-1 text-[11px] text-blue-400">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {status === 'starting' ? 'Starting' : 'Stopping'}
              </span>
            ) : status === 'running' ? (
              <Button variant="ghost" size="xs" className="h-7" onClick={() => onStop(profile.id)}>
                Stop
              </Button>
            ) : (
              <Button variant="outline" size="xs" className="h-7" onClick={() => onLaunch(profile.id)}>
                {status === 'failed' ? 'Retry' : 'Launch'}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-white/[0.07]" role="status" aria-label="Loading profiles">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center justify-between gap-4 py-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-52 rounded" />
            <Skeleton className="h-3 w-72 rounded" />
          </div>
          <Skeleton className="h-4 w-14 rounded" />
        </li>
      ))}
    </ul>
  );
}
