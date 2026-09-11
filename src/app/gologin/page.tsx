'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCcw, Search, Settings2, Unlock, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useNetworkStatus } from '@/contexts/NetworkStatusContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useUserData } from '@/hooks/useUserData';
import { useGoLoginAccount } from '@/hooks/useGoLoginAccount';
import { useGoLoginLocks, type GoLoginLock } from '@/hooks/useGoLoginLocks';
import { useGoLoginProfiles } from '@/hooks/useGoLoginProfiles';
import { useGoLoginSessions } from '@/hooks/useGoLoginSessions';
import { useOrbita } from '@/hooks/useOrbita';
import { useGoLoginCloseGuard } from '@/hooks/useGoLoginCloseGuard';
import type { GoLoginSession } from '@/types/electron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isManagedGoLoginFolder, type GoLoginProfile } from '@/lib/gologin/types';
import { SESSION_ERRORS, TONE_CHIP, sessionErrorMessage } from './_lib/session';
import GoLoginOnboarding from './_components/GoLoginOnboarding';
import ManagementDialog from './_components/ManagementDialog';
import Notice from './_components/Notice';
import OrbitaGate from './_components/OrbitaGate';
import CloseGuard, { type BusyProfile } from './_components/CloseGuard';

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
 * How many folder chips the header shows before collapsing the rest.
 *
 * Two rows' worth at a typical window width. The row grows with the workspace
 * and the viewport does not, so without a cap the header wins a fight it should
 * never be in — see the chip row below.
 */
const FOLDER_CHIP_CAP = 8;

/**
 * GoLogin — the browser-profile console.
 *
 * This window has four states and renders exactly one of them:
 *
 *   1. **Onboarding**, until the operator has linked their own GoLogin account.
 *      There is nothing to list before that — profiles reach them by being shared
 *      into their personal account — so a list here would be an empty state that
 *      misrepresents why it is empty.
 *   2. **The Orbita gate**, whenever the browser is downloading or installing.
 *      It covers everything, because it can begin *mid-launch*: the Orbita major
 *      version a profile needs comes from that profile's own user agent, so a
 *      long-onboarded operator can trip one at any time.
 *   3. **A rejected API token.** Its own screen rather than an error line,
 *      because the remedy is not "try again" — it is a new key, and the only
 *      route back to entering one is to unlink the old one first.
 *   4. **The profile list**, the ordinary case.
 *
 * A single pane, so it reuses the satellite shell's chrome (eyebrow section
 * title, hairline rules, the overlay recipe, filter chips) rather than its
 * two-pane layout — there is no second pane to justify one. See DESIGN.md § The
 * satellite-window shell.
 */
export default function GoLoginPage() {
  const { isOnline } = useNetworkStatus();
  const { userData } = useUserData();
  // Seeded off the user-doc snapshot the layout already holds, so a linked
  // operator never watches a spinner to find out they are linked.
  const {
    account,
    loading: accountLoading,
    error: accountError,
    link,
    unlink,
    reload: reloadAccount,
  } = useGoLoginAccount({
    email: userData?.gologinEmail,
    linkedAt: userData?.gologinLinkedAt,
  });
  const orbita = useOrbita();
  const closeGuard = useGoLoginCloseGuard();
  const { locks } = useGoLoginLocks();
  const {
    sessions,
    supported: sessionsSupported,
    launch: launchSession,
    stop: stopSession,
  } = useGoLoginSessions();
  const { profiles, total, truncated, fetchedAtMs, loading, refreshing, error, errorCode, refresh } =
    useGoLoginProfiles(account.linked);
  const authFetch = useAuthFetch();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [managing, setManaging] = useState(false);
  const [allFolders, setAllFolders] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  /** The profile an admin is about to take off a colleague, pending confirmation. */
  const [confirmRelease, setConfirmRelease] = useState<{
    id: string;
    name: string;
    holder: string;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Client-side convenience only. Every admin route behind it re-checks with
  // `requireGoLoginAdmin` (rule 3), so hiding a button is not the control — and
  // that helper, rather than a bare claim check, is why this snapshot-derived
  // flag and the server agree on a renderer that has been open for weeks.
  const isAdmin = userData?.groups?.includes('admin') === true;

  /**
   * Sessions that make closing the window a bad idea, named.
   *
   * Derived from the live session map rather than from the payload main sent
   * with the block — a list captured once would not count down as each profile
   * finishes, and the banner, the dialog and the row badges would drift apart.
   * Names come from the profile list, because "3 profiles" is not enough to
   * decide with.
   */
  const busyProfiles = useMemo<BusyProfile[]>(() => {
    const nameById = new Map(profiles.map((p) => [p.id, p.name]));
    return Object.values(sessions)
      .filter(
        (s) =>
          !!s.profileId &&
          (s.status === 'starting' || s.status === 'running' || s.status === 'stopping'),
      )
      .map((s) => ({
        profileId: s.profileId as string,
        name: nameById.get(s.profileId as string) || 'Untitled profile',
        status: s.status,
      }));
  }, [sessions, profiles]);

  const savingProfiles = useMemo(
    () => busyProfiles.filter((p) => p.status === 'stopping'),
    [busyProfiles],
  );

  /**
   * A profile's folders minus Bluu's own plumbing.
   *
   * Every profile an operator can see sits in *their* `Bluu · …` folder — that
   * is the mechanism by which they can see it — so as a filter chip it matches
   * everything and as a row chip it appears on every row. It carries no
   * information and crowds out the folders that do (REPOST, JORGE, …). Admins
   * see the whole workspace, so for them it is every *other* operator's folder
   * that clutters the view; both are removed by the same test.
   *
   * Display only. Nothing that grants or revokes access consults this — see
   * `isManagedGoLoginFolder`.
   */
  const visibleFolders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const profile of profiles) {
      map.set(profile.id, profile.folders.filter((name) => !isManagedGoLoginFolder(name)));
    }
    return map;
  }, [profiles]);

  // Search first, folder second — the split is what lets the folder counts below
  // be faceted (each count is measured with the folder filter cleared, so the
  // number beside a chip is what clicking it actually produces).
  const searchMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((p) =>
      // Searched over the *visible* folders, so a hidden plumbing folder cannot
      // match a query and return rows for a reason nothing on screen explains.
      [p.name, p.notes, p.proxyRegion, p.os, ...(visibleFolders.get(p.id) ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [profiles, query, visibleFolders]);

  const folderFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of searchMatches) {
      for (const name of visibleFolders.get(profile.id) ?? []) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [searchMatches, visibleFolders]);

  // A folder that disappears (the search narrowed past it, or a refresh removed
  // it) must not leave the list filtered by something with no chip left to
  // unset — so the selection is *derived* rather than corrected in an effect.
  const activeFolder =
    folder && folderFacets.some(([name]) => name === folder) ? folder : null;

  // The chip row is capped so the header cannot outgrow the list it describes.
  // The selected chip is always kept — a filter you cannot see is a filter you
  // cannot clear.
  const visibleFacets = useMemo(() => {
    if (allFolders || folderFacets.length <= FOLDER_CHIP_CAP) return folderFacets;
    const head = folderFacets.slice(0, FOLDER_CHIP_CAP);
    if (!activeFolder || head.some(([name]) => name === activeFolder)) return head;
    const selected = folderFacets.find(([name]) => name === activeFolder);
    return selected ? [...head.slice(0, FOLDER_CHIP_CAP - 1), selected] : head;
  }, [folderFacets, allFolders, activeFolder]);

  const hiddenFacetCount = folderFacets.length - visibleFacets.length;


  /**
   * Anything live, first — then the provider's own order.
   *
   * An operator's own running sessions are the rows they come back to, and
   * alphabetical order scatters three of them through hundreds. Sorting by
   * *liveness* rather than by name keeps the surface stable the rest of the
   * time: nothing reorders as you read, because the only thing that moves a row
   * is a session starting or stopping, which the operator caused.
   *
   * Locked-by-someone-else counts as live: it is the other row you need to find
   * quickly, because it is the one you have to go and ask about.
   */
  const filtered = useMemo(() => {
    const base = activeFolder
      ? searchMatches.filter((p) => p.folders.includes(activeFolder))
      : searchMatches;
    const rank = (p: GoLoginProfile) => {
      const status = sessions[p.id]?.status;
      if (status === 'running' || status === 'starting' || status === 'stopping') return 0;
      if (locks[p.id]) return 1;
      if (p.isRunning) return 2;
      return 3;
    };
    // A stable sort over a copy — `base` is a memo the facet counts also read.
    return [...base].sort((a, b) => rank(a) - rank(b));
  }, [searchMatches, activeFolder, sessions, locks]);

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

  /**
   * How old the listing is, in words, kept honest by a one-minute tick.
   *
   * A minute, not a second: the number it renders changes at minute resolution,
   * so a faster interval would re-render the window for a string that did not
   * change. It runs only while a listing exists — a cold or failed window has
   * no age to report.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!fetchedAtMs) return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [fetchedAtMs]);
  const fetchedAt = fetchedAtMs ? relativeTime(fetchedAtMs, nowMs) : null;

  // Clears the guard dialog for the operator who chose Cancel and is still
  // watching. The closing cases are main's to act on — it owns the window — so
  // nothing here races it.
  const stillSaving = savingProfiles.length > 0;
  const stillBusy = busyProfiles.length > 0;
  useEffect(() => {
    closeGuard.clearIfIdle(stillBusy);
  }, [closeGuard, stillBusy]);

  const clearFilters = () => {
    setQuery('');
    setFolder(null);
  };

  /**
   * The keyboard model, and the one thing it deliberately does not do.
   *
   * `/` focuses search, `j`/`k` walk the rows, `Enter` fires the focused row's
   * own button. Movement is **DOM focus**, not a React "cursor" — a parallel
   * selection state would have to be kept in step with a list that reorders as
   * sessions start, and every keystroke would re-render the window. Focus is
   * already the browser's version of that state, it survives the reorder, and it
   * is what a screen reader reads.
   *
   * `Enter` activating the focused control is the browser's own behaviour, so
   * there is no handler for it here: `j`/`k` only have to put focus in the right
   * place. That is also what keeps a keystroke from ever firing a billed
   * provider call by itself — the operator still presses Enter on a button they
   * can see is focused.
   */
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'j' && event.key !== 'k') return;

    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-row-action]') ?? [],
    ).filter((el) => !el.disabled);
    if (!buttons.length) return;

    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // From nowhere, `j` starts at the top and `k` at the bottom — the same
    // convention the sibling satellite uses, and the only reading of "next" that
    // works when nothing is focused yet.
    const next =
      at === -1
        ? event.key === 'j'
          ? 0
          : buttons.length - 1
        : Math.min(buttons.length - 1, Math.max(0, at + (event.key === 'j' ? 1 : -1)));
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView({ block: 'nearest' });
  }, []);

  /**
   * Admin override: take a lock off a colleague.
   *
   * The server route has existed since the lock did; nothing ever called it, so
   * the only way to free a wedged claim was the Firestore console. It stays an
   * admin action and stays confirmed — this ends someone else's session — but
   * "the holder's machine died" is common enough that it cannot live outside the
   * product.
   */
  const forceRelease = useCallback(
    async (profileId: string, name: string, holder: string) => {
      setReleasing(profileId);
      try {
        await authFetch('/api/gologin/session-lock', {
          method: 'POST',
          body: JSON.stringify({ action: 'force-release', profileId }),
        });
        toast.success(`Released ${name} from ${holder}.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not release that profile.');
      } finally {
        setReleasing(null);
      }
    },
    [authFetch],
  );

  // ── State 1: not linked yet ────────────────────────────────────────
  // `accountLoading` is only ever true on a cold window with no seed, so this
  // skeleton is the rare case rather than the usual one.
  if (accountLoading) {
    return (
      <div className="flex h-full w-full flex-col gap-3 bg-background p-6" role="status" aria-label="Loading GoLogin">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    );
  }

  // ── State 1a: the seat could not be checked ────────────────────────
  // Checked BEFORE membership, because a failed lookup leaves `account` at its
  // empty default — and reading that as "not a member" reports a fact we do not
  // have. A missing `GL_API_TOKEN` on the server used to surface here as "ask an
  // admin to add you", which sent the reader after the wrong remedy entirely.
  if (accountError) {
    return (
      <Notice
        title="Could not check your GoLogin access"
        body={accountError}
        action={{ label: 'Try again', onClick: reloadAccount }}
      />
    );
  }

  // ── State 1b: no GoLogin seat ──────────────────────────────────────
  // Ahead of onboarding on purpose. A free GoLogin account cannot generate an
  // API token — only a paid workspace member can — so walking a non-member
  // through step 3 would send them after something that does not exist for
  // them. Admins never reach this: they operate on the master token and the
  // server reports them as members without consulting GoLogin.
  if (!account.member) {
    return (
      <Notice
        title="You have not been added to GoLogin yet"
        body="GoLogin needs a workspace seat, which an admin grants. Ask one to add you — this window picks it up the moment they have."
        // Was "then reopen this window", which is a workaround dressed up as an
        // instruction: the seat check is one cheap request and the operator can
        // simply ask for it again.
        action={{ label: 'Check again', onClick: reloadAccount }}
      />
    );
  }

  if (!account.linked) {
    return (
      <div className="relative h-full w-full">
        <GoLoginOnboarding
          orbita={orbita.state}
          orbitaSupported={orbita.supported}
          orbitaInstalled={orbita.installed}
          glEmail={account.glEmail}
          joined={account.joined}
          onDownloadOrbita={() => void orbita.ensure()}
          onSubmitKey={link}
          // Step 2 completes in another application. Without this the operator
          // accepts the invitation in their inbox, comes back, and finds the
          // step still unticked with nothing on screen to do about it.
          onRecheck={reloadAccount}
        />
      </div>
    );
  }

  // ── State 3: GoLogin is refusing the token ─────────────────────────
  // Its own screen, not the inline error below, because the remedy is a new key
  // and the inline error's only control is a Retry that cannot work. Unlinking
  // is what returns them to onboarding step 3 — there is no other route to the
  // paste field once an account is linked.
  if (errorCode === 'invalid-token') {
    return (
      <Notice
        title="GoLogin is not accepting your API token"
        body={`${SESSION_ERRORS['invalid-token']} In GoLogin, sign in as ${account.glEmail || 'your workspace address'} and create a new token under API & MCP.`}
        action={{
          label: 'Replace my token',
          variant: 'primary',
          onClick: () => {
            void unlink().catch(() =>
              toast.error('Could not clear the old token. Try again in a moment.'),
            );
          },
        }}
      />
    );
  }

  return (
    // The keyboard model is bound here rather than on `window`: this window
    // hosts modal overlays (Orbita, the close guard) that render as siblings
    // *outside* this subtree, and a document listener would keep stealing `/`
    // and `j`/`k` from a dialog that is meant to have the keyboard to itself.
    <div
      className="relative flex h-full w-full flex-col bg-background"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
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
          <div className="flex shrink-0 items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
                <Settings2 aria-hidden />
                Management
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing || loading || !isOnline}
              // Offline is the one disabled reason nothing else on screen
              // explains — refreshing and loading both show their own spinner.
              title={!isOnline ? 'You are offline — reconnect to refresh.' : undefined}
            >
              <RefreshCcw className={refreshing ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search profiles"
            aria-label="Search profiles"
            className="border-zinc-700 bg-zinc-800 pl-9 pr-16"
          />
          {/* The shortcut is printed rather than left to be discovered. An
              operator who lives on this surface all day is exactly the reader
              who will use it, and exactly the one who will never find it
              otherwise. Hidden while typing, when it is no longer true. */}
          {!query && (
            <kbd
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/[0.12] px-1.5 py-0.5 font-mono text-[11px] leading-none text-zinc-400"
              aria-hidden
            >
              /
            </kbd>
          )}
        </div>

        {/* Folders as filter chips. A profile carries its folders as an open set
            of names, so they are the one grouping this surface actually has —
            and a chip row directly under the search reads as "narrow what you
            just typed", which is what it does. */}
        {/* Capped, because this row grows with the workspace and the list does
            not. Uncapped, a twenty-folder workspace pushed the eyebrow, title,
            search, chips and count line past the fold before a single profile
            row rendered — the header out-competing the thing it describes. The
            selected folder is always shown even when it sits past the cap, so
            expanding is never the only way to see what is filtering the list. */}
        {folderFacets.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <FolderChip
              label="All"
              count={searchMatches.length}
              selected={activeFolder === null}
              onSelect={() => setFolder(null)}
            />
            {visibleFacets.map(([name, count]) => (
              <FolderChip
                key={name}
                label={name}
                count={count}
                selected={activeFolder === name}
                onSelect={() => setFolder(activeFolder === name ? null : name)}
              />
            ))}
            {/* Tested against the *total*, not the hidden count — expanded,
                nothing is hidden, and keying off that would remove the only
                control that collapses the row again. */}
            {folderFacets.length > FOLDER_CHIP_CAP && (
              <button
                type="button"
                onClick={() => setAllFolders((prev) => !prev)}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-400 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]"
              >
                {allFolders ? 'Show fewer' : `+${hiddenFacetCount} more`}
              </button>
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] text-zinc-400">
          {loading ? (
            // A named wait, not a bare "Loading…". Listing every profile is one
            // provider request per 30 of them, walked strictly sequentially to
            // stay under the rate limit, so this is genuinely slow on a large
            // workspace — and a reader who knows why waits differently than one
            // who thinks the app has hung.
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading profiles from GoLogin…
            </span>
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
              {/* Nothing on this surface polls — deliberately, because polling
                  GoLogin is what revokes the API token. A list that refuses to
                  auto-refresh owes the reader the age of what they are reading;
                  without it, "nothing polls" is indistinguishable from "this is
                  live", and an operator launches a profile that was unassigned
                  an hour ago. */}
              {fetchedAt && (
                <>
                  {' · read '}
                  {fetchedAt}
                </>
              )}
            </>
          )}
        </p>

        {/*
          Saving is the one state in this window worth interrupting the reader
          for. A profile's cookies and logins are uploading, and quitting the app
          over it loses that work — so it gets a banner in the header rather than
          a grey word on one row. Blue, not red: it is work in progress, not a
          failure, and the operator's job is simply to wait.
        */}
        {stillSaving && (
          <p
            // `-400`, the triad's foreground step — this was the only `-200` in
            // the window, a fifth grey-adjacent tone for no reason the palette
            // names.
            className="mt-3 flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-400"
            role="status"
          >
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            <span>
              Saving{' '}
              <span className="tabular-nums font-medium">{savingProfiles.length}</span>
              {savingProfiles.length === 1 ? ' profile' : ' profiles'} back to GoLogin — keep Bluu
              open until this finishes, or the session is lost.
            </span>
          </p>
        )}

        {/*
          Orbita is not installed yet, so the next Launch is a several-hundred-
          megabyte download that takes the whole window. Main already knows
          this; nothing was saying so, and the operator found out by clicking.
          A condition, not an error — and it carries the action, because
          downloading it now is strictly better than discovering it mid-task.
        */}
        {orbita.supported && !orbita.installed && !orbita.busy && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400">
            <Download className="size-3.5 shrink-0" aria-hidden />
            <span>The Orbita browser is not installed — the first launch downloads it.</span>
            <button
              type="button"
              onClick={() => void orbita.ensure()}
              className="rounded underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
            >
              Install it now
            </button>
          </p>
        )}

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
            <ul ref={listRef} className="divide-y divide-white/[0.07]">
              {visible.map((profile) => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  folders={visibleFolders.get(profile.id) ?? []}
                  session={sessions[profile.id]}
                  lock={locks[profile.id]}
                  myUid={userData?.uid}
                  canLaunch={sessionsSupported}
                  isAdmin={isAdmin}
                  releasing={releasing === profile.id}
                  onLaunch={launchSession}
                  onStop={stopSession}
                  onForceRelease={(p, holder) =>
                    setConfirmRelease({
                      id: p.id,
                      name: p.name || 'this profile',
                      holder,
                    })
                  }
                />
              ))}
            </ul>
            {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden />}
          </>
        )}
      </div>

      {isAdmin && (
        <ManagementDialog
          open={managing}
          onOpenChange={setManaging}
          // A grant only reaches the operator's own list on their next fetch, but
          // an admin editing their *own* access should see it immediately.
          onChanged={refresh}
        />
      )}

      {/*
        Confirmed, because it ends a colleague's session on another machine and
        there is no undo — the same bar `MembersPanel` applies to removing a
        seat. It names the holder and states the cost, which is the half of the
        decision an admin cannot see from here.
      */}
      <AlertDialog
        open={!!confirmRelease}
        onOpenChange={(open) => !open && setConfirmRelease(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Release {confirmRelease?.name} from {confirmRelease?.holder}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This clears Bluu&rsquo;s lock so anyone assigned the profile can open it. It does not
              close {confirmRelease?.holder}&rsquo;s browser — if theirs is still open, their
              session will not be saved back to GoLogin and two people could end up signed into the
              same account. Use it when their machine is unreachable, not to jump a queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (!confirmRelease) return;
                const { id, name, holder } = confirmRelease;
                setConfirmRelease(null);
                void forceRelease(id, name, holder);
              }}
            >
              Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Last, and inside the window's own stacking context so it covers the
        header and the dialog alike. An Orbita download blocks everything
        because everything else on this surface leads somewhere that will fail
        until it finishes.
      */}
      {orbita.busy && <OrbitaGate state={orbita.state} />}

      {/*
        Last of all, so it sits above the Orbita gate too — a download can be
        abandoned and resumed, an interrupted upload cannot.
      */}
      {closeGuard.blocked && stillBusy && (
        <CloseGuard
          profiles={busyProfiles}
          closing={closeGuard.closing}
          onDecision={closeGuard.decide}
        />
      )}
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
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] ${
        selected
          ? 'bg-[#2563eb] text-white'
          : 'bg-white/[0.04] text-zinc-400 hover:bg-white/[0.055] hover:text-white active:bg-white/[0.08]'
      }`}
    >
      {/* No `opacity` on the count. Stacked on Ink Secondary it lands under the
          contrast floor, and the count is the half of the chip a reader is
          actually comparing across the row. The unselected chip's own colour is
          already the de-emphasis step. */}
      {label} <span className="tabular-nums">{count}</span>
    </button>
  );
}

/**
 * The row's status dot, as a **three**-value vocabulary.
 *
 * It used to be two, and the collapse was wrong: `liveHere || blocked ||
 * isRunning` painted the same green on "you have this open" and "someone else
 * has this open", which are opposite answers to the only question the dot is
 * asked. The chips disambiguated and the dot contradicted them. Green now means
 * *yours*, blue means *live, but not yours*, zinc means idle — the same triad
 * `session.ts` uses, borrowed from `STATUS_COLORS` rather than invented.
 */
const MINE_DOT = 'bg-green-400';
const OTHER_DOT = 'bg-blue-400';
const IDLE_DOT = 'bg-zinc-500';

const OS_LABELS: Record<string, string> = {
  win: 'Windows',
  mac: 'macOS',
  lin: 'Linux',
  android: 'Android',
};

/**
 * `now` is passed in rather than read here so a caller that re-renders on a
 * timer gets a value that actually changes — a `Date.now()` inside would be
 * recomputed identically on every render that was not driven by the clock.
 */
function relativeTime(msSince: number | null, now = Date.now()): string | null {
  if (!msSince) return null;
  const diff = now - msSince;
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
  folders,
  session,
  lock,
  myUid,
  canLaunch,
  isAdmin,
  releasing,
  onLaunch,
  onStop,
  onForceRelease,
}: {
  profile: GoLoginProfile;
  /** Bluu's own per-operator folders already stripped — see `visibleFolders`. */
  folders: string[];
  session?: GoLoginSession;
  /** A live claim from any machine, including this one. */
  lock?: GoLoginLock;
  myUid?: string;
  canLaunch: boolean;
  /** Client-side convenience only — the route re-checks (rule 3). */
  isAdmin: boolean;
  releasing: boolean;
  onLaunch: (profileId: string) => Promise<boolean>;
  onStop: (profileId: string) => Promise<boolean>;
  onForceRelease: (profile: GoLoginProfile, holder: string) => void;
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
  // Three facts that all read as "running", kept apart on purpose:
  //
  //   • `session` — a browser open on THIS machine, which we can stop.
  //   • `lock` — Bluu's own session lock, live across every machine. When it is
  //     held by someone else this row is blocked, and blocked here means the
  //     server will refuse the launch, not merely that the button is greyed.
  //   • `profile.isRunning` — GoLogin's own flag. Kept as a weaker last resort
  //     because it also catches someone running the profile outside Bluu, which
  //     our lock cannot see. It is only as fresh as the last profile fetch.
  const liveHere = status === 'running';
  const lockedByOther = !!lock && lock.uid !== myUid;
  const liveElsewhere = !liveHere && !lockedByOther && profile.isRunning;
  const blocked = lockedByOther;

  // The proxy is checked before anything spawns, so this is the most common way
  // a launch fails — and unlike the others it names something the operator can
  // go and fix. It earns a red chip rather than living only in the toast that
  // already vanished.
  const proxyFailed = status === 'failed' && session?.error === 'proxy-error';

  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${
              liveHere ? MINE_DOT : blocked || profile.isRunning ? OTHER_DOT : IDLE_DOT
            }`}
            aria-hidden
          />
          <span className="truncate text-sm font-medium text-white">
            {profile.name || 'Untitled profile'}
          </span>
          {liveHere && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP.green}`}>
              Open here
            </span>
          )}
          {/* Naming the holder is the point: the reader's next move is to go and
              ask that person, which "in use elsewhere" does not support. */}
          {blocked && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP.zinc}`}>
              {`In use · ${lock!.displayName}`}
            </span>
          )}
          {liveElsewhere && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP.zinc}`}>
              {profile.runningUserEmail ? `In use · ${profile.runningUserEmail}` : 'In use elsewhere'}
            </span>
          )}
          {/* Red, because unlike every other chip on this row it reports
              something broken that stays broken until someone acts. The full
              remedy is on the title, so the chip stays two words. */}
          {proxyFailed && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP.red}`}
              title={sessionErrorMessage('proxy-error')}
            >
              Proxy Error
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
        {folders.map((name) => (
          <span
            key={name}
            className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300"
          >
            {name}
          </span>
        ))}
        {/* The profile's GoLogin id, for matching a row against GoLogin's own
            dashboard. A reference, not an attribute — so it steps back below
            the folder chips rather than sitting at their weight, and says what
            it is to a screen reader instead of reading out six characters. */}
        <span className="font-mono text-[11px] text-zinc-400" title="GoLogin profile id">
          <span className="sr-only">GoLogin id </span>
          {profile.id.slice(-6)}
        </span>
        {/* The action lane. Always visible rather than revealed on hover,
            because launching is now this page's whole job — the decision-queue
            rule, not the faceted-index one. */}
        {canLaunch && (
          <div className="flex items-center gap-1.5">
            {/* An admin's way out of a wedged claim. The holder's machine losing
                power frees the lock after three minutes, but a holder whose app
                is hung never heartbeats *or* releases — and until now the only
                remedy was the Firestore console. Admin-only, and it ends someone
                else's session, so it names them and asks first. */}
            {blocked && isAdmin && (
              <Button
                variant="ghost"
                size="xs"
                data-row-action
                className="h-7 text-zinc-400 hover:text-red-400"
                disabled={releasing}
                title={`Force-release this profile from ${lock!.displayName}`}
                onClick={() => onForceRelease(profile, lock!.displayName)}
              >
                {releasing ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Unlock className="size-3.5" aria-hidden />
                )}
                Release
              </Button>
            )}
            {status === 'starting' || status === 'stopping' ? (
              <span className="flex items-center gap-1.5 px-1 text-[11px] text-blue-400">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {status === 'starting' ? 'Starting' : 'Stopping'}
              </span>
            ) : status === 'running' ? (
              <Button
                variant="ghost"
                size="xs"
                data-row-action
                className="h-7"
                onClick={() => onStop(profile.id)}
              >
                Stop
              </Button>
            ) : (
              // Disabled rather than hidden: a missing button reads as "this row
              // has no action", when the fact is "not right now, and here is who
              // has it". The server refuses the launch either way — this only
              // saves the operator a round trip to be told so.
              <Button
                variant="outline"
                size="xs"
                // `data-row-action` is what `j`/`k` walks. Marked on the row's
                // own primary control rather than on the row, so Enter lands on
                // the thing the operator came for and a disabled one is skipped.
                data-row-action
                className="h-7"
                disabled={blocked}
                title={blocked ? `${lock!.displayName} has this profile open` : undefined}
                onClick={() => onLaunch(profile.id)}
              >
                {blocked ? 'In use' : status === 'failed' ? 'Retry' : 'Launch'}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The loading state for the list.
 *
 * Shaped like the rows it replaces — status dot, name, meta line, then the
 * right-hand lane of folder chip, id and action button — so the layout does not
 * jump when the real data lands. The widths vary per row because a column of
 * identical bars reads as a rendering artefact rather than as content arriving.
 */
const SKELETON_ROWS = [
  { name: 'w-44', meta: 'w-64' },
  { name: 'w-56', meta: 'w-52' },
  { name: 'w-36', meta: 'w-72' },
  { name: 'w-52', meta: 'w-56' },
  { name: 'w-40', meta: 'w-64' },
  { name: 'w-60', meta: 'w-48' },
  { name: 'w-44', meta: 'w-60' },
  { name: 'w-48', meta: 'w-56' },
];

function ListSkeleton() {
  return (
    <ul className="divide-y divide-white/[0.07]" role="status" aria-label="Loading profiles">
      {SKELETON_ROWS.map((row, i) => (
        <li key={i} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 shrink-0 rounded-full" />
              <Skeleton className={`h-4 ${row.name} rounded`} />
            </div>
            <Skeleton className={`mt-1.5 h-3 ${row.meta} rounded`} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Skeleton className="h-5 w-16 rounded-md" />
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

