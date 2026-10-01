'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  type GoLoginSharingMember as SharingMember,
  type GoLoginSharingOverview as Overview,
} from '@/lib/gologin/types';
import {
  CHECKBOX_ON,
  DANGER_BUTTON,
  FIELD,
  PRIMARY_BUTTON,
  plural,
  type ManagedFolder,
} from '../_lib/manage';
import OsIcon from './OsIcon';

type SharingProfile = Overview['profiles'][number];
type Kind = 'folders' | 'profiles';
type Action = 'add' | 'remove';

/** How many of the selected people hold something: none, some, or all. */
type Coverage = { n: number; of: number };

function isFull({ n, of }: Coverage): boolean {
  return of > 0 && n === of;
}

function coverageLabel(cov: Coverage): string {
  if (cov.n === 0) return 'Not shared';
  if (isFull(cov)) return 'Shared';
  return `${cov.n} of ${cov.of}`;
}

/** "Kai", "Kai, Sam", "Kai, Sam and 3 more" — who a control writes to. */
function peopleLabel(people: SharingMember[]): string {
  if (people.length <= 3) return people.map((m) => m.displayName).join(', ');
  return `${people.slice(0, 2).map((m) => m.displayName).join(', ')} and ${people.length - 2} more`;
}

const ROW =
  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 disabled:cursor-default';

/**
 * Sharing — who can open which profiles and folders. Replaced Management's
 * Profile access tab on 2026-09-30.
 *
 * ## Two questions, two views
 *
 * **People first** (the header's Sharing button): pick one or more people on the
 * left; every folder and profile on the right shows how many of *them* hold it
 * — `Shared`, `2 of 3`, `Not shared` — and one click evens it out.
 *
 * **Profile first** (a row's "Share profile"): the question there is "who can
 * open *this*?", which the people-first grid cannot answer without selecting
 * everyone. So the dialog opens on that one profile — addressed by **id**, never
 * by a name search that "Cole" would also match in "Cole · TikTok" — and lists
 * every member as Shared / via a folder / No access, one toggle each.
 *
 * ## Two kinds of access, both shown
 *
 *   • **A shared folder is live** — profiles added to it later reach its people.
 *   • **A shared profile is a single grant** into their personal folder.
 *
 * Access *through a folder* is labelled (`via REPOST`), because unsharing the
 * profile individually does not remove it.
 *
 * Every change toasts with an **Undo** that reverses it for exactly the people
 * it landed on. Whole-folder changes are also confirmed first, with the count.
 */
export default function SharingDialog({
  open,
  onOpenChange,
  onChanged,
  focusProfile = null,
  myUid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired on close only when **the caller's own** access changed — sharing with
   * colleagues changes nothing in the caller's list, and a Refresh is a full
   * re-walk against the rate limit.
   */
  onChanged: () => void;
  myUid: string | undefined;
  /** Opened from a row's "Share profile": start on that profile's own view. */
  focusProfile?: { id: string; name: string } | null;
}) {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(focusProfile);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmFolder, setConfirmFolder] = useState<{ folder: ManagedFolder; action: Action } | null>(null);
  const dirtyRef = useRef(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      setError(null);
      try {
        const next: Overview = await authFetch(`/api/gologin/manage/sharing${force ? '?refresh=1' : ''}`);
        if (aliveRef.current) setData(next);
      } catch (err) {
        if (aliveRef.current) setError(err instanceof Error ? err.message : 'Could not load sharing.');
      }
    },
    [authFetch],
  );

  useEffect(() => {
    if (open) void load(false);
  }, [open, load]);

  const members = useMemo(() => data?.members ?? [], [data]);
  // Derived against the current list, so a person who vanished on a reload can
  // never be written to by an invisible selection.
  const selected = useMemo(() => members.filter((m) => picked.has(m.uid)), [members, picked]);
  const folderById = useMemo(() => new Map((data?.folders ?? []).map((f) => [f.id, f])), [data?.folders]);

  const visibleMembers = useMemo(() => {
    const needle = peopleQuery.trim().toLowerCase();
    return needle
      ? members.filter((m) => `${m.displayName} ${m.glEmail}`.toLowerCase().includes(needle))
      : members;
  }, [members, peopleQuery]);

  /** The folders through which one member reaches one profile. */
  const viaFor = useCallback(
    (member: SharingMember, profileId: string) =>
      member.folderIds
        .map((id) => folderById.get(id))
        .filter((f): f is ManagedFolder => !!f && f.profileIds.includes(profileId))
        .map((f) => f.name),
    [folderById],
  );

  /**
   * Per profile, across the selected people: how many hold it directly, and
   * which of their shared folders reach it anyway. One pass per selection change
   * — the list is every profile in the workspace and re-renders per keystroke.
   */
  const reach = useMemo(() => {
    const direct = new Map<string, number>();
    const via = new Map<string, Set<string>>();
    for (const m of selected) {
      for (const id of m.profileIds) direct.set(id, (direct.get(id) ?? 0) + 1);
      for (const folderId of m.folderIds) {
        const folder = folderById.get(folderId);
        if (!folder) continue;
        for (const id of folder.profileIds) {
          const names = via.get(id) ?? new Set<string>();
          names.add(folder.name);
          via.set(id, names);
        }
      }
    }
    return { direct, via };
  }, [selected, folderById]);

  const profiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = data?.profiles ?? [];
    return needle
      ? all.filter((p) => [p.name, ...p.folders].join(' ').toLowerCase().includes(needle))
      : all;
  }, [data?.profiles, query]);

  /**
   * Apply a share locally, from the server's own report of who it landed for.
   * No re-read on success: the overview costs a profile walk, and the write's
   * result is already known.
   */
  const applyLocal = (kind: Kind, id: string, action: Action, uids: string[]) => {
    const key = kind === 'folders' ? 'folderIds' : 'profileIds';
    setData((prev) =>
      prev
        ? {
            ...prev,
            members: prev.members.map((m) => {
              if (!uids.includes(m.uid)) return m;
              const list = m[key];
              const next = action === 'add' ? [...new Set([...list, id])] : list.filter((x) => x !== id);
              return { ...m, [key]: next };
            }),
          }
        : prev,
    );
  };

  /**
   * Share or unshare one item with these people. Toasts the outcome with an
   * **Undo** that sends the inverse to exactly the people it landed on — a
   * mis-click here hands out, or takes back, a live account.
   */
  const share = async (
    kind: Kind,
    id: string,
    action: Action,
    label: string,
    people: SharingMember[],
    { undoable = true } = {},
  ) => {
    if (busy) return;
    const uids = people.filter((m) => m.hasSeat).map((m) => m.uid);
    if (!uids.length) {
      toast.error(people.length === 1 ? 'Their GoLogin seat has been removed.' : 'None of them hold a GoLogin seat any more.');
      return;
    }
    setBusy(`${kind}:${id}|${uids.join(',')}`);
    try {
      const result: { done: number; failed: { uid: string; reason: string }[] } = await authFetch(
        '/api/gologin/manage/sharing',
        { method: 'POST', body: JSON.stringify({ kind, uids, ids: [id], action }) },
      );
      const failedUids = new Set(result.failed.map((f) => f.uid));
      const landedUids = uids.filter((uid) => !failedUids.has(uid));
      applyLocal(kind, id, action, landedUids);
      if (myUid && landedUids.includes(myUid)) dirtyRef.current = true;

      const landedPeople = people.filter((m) => landedUids.includes(m.uid));
      const who = landedPeople.length === 1 ? landedPeople[0].displayName : plural(landedPeople.length, 'person', 'people');
      const message =
        action === 'add' ? `Shared ${label} with ${who}.` : `Stopped sharing ${label} with ${who}.`;
      const undo =
        undoable && landedPeople.length
          ? {
              label: 'Undo',
              onClick: () =>
                void share(kind, id, action === 'add' ? 'remove' : 'add', label, landedPeople, { undoable: false }),
            }
          : undefined;

      if (result.failed.length) {
        const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? uid;
        toast.error(`${message} ${result.failed.length} failed.`, {
          description: result.failed.slice(0, 4).map((f) => `${nameOf(f.uid)}: ${f.reason}`).join('\n'),
          duration: 12_000,
          action: undo,
        });
      } else {
        toast.success(message, { duration: 8_000, action: undo });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That change did not save.');
      void load(true);
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  const close = (next: boolean) => {
    if (!next && dirtyRef.current) {
      dirtyRef.current = false;
      onChanged();
    }
    onOpenChange(next);
  };

  const togglePerson = (uid: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(uid);
      else next.delete(uid);
      return next;
    });

  /** Is this item being written — optionally, for this one person? */
  const isBusy = (kind: Kind, id: string, uid?: string) =>
    !!busy && busy.startsWith(`${kind}:${id}|`) && (!uid || busy.split('|')[1].split(',').includes(uid));

  const allVisiblePicked = visibleMembers.length > 0 && visibleMembers.every((m) => picked.has(m.uid));
  const selectedNames = selected.length ? peopleLabel(selected) : null;
  const focused = focus ? data?.profiles.find((p) => p.id === focus.id) : undefined;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className={`flex h-[min(82vh,760px)] flex-col gap-0 overflow-hidden p-0 ${focus ? 'sm:max-w-2xl' : 'sm:max-w-5xl'}`}
      >
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-6 pb-4 pt-5 text-left">
          <DialogTitle className="truncate pr-6 text-lg font-semibold text-white">
            {focus ? `Who can open ${focus.name || 'this profile'}` : 'Sharing'}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-400">
            {focus
              ? 'Share it with one person at a time, or stop sharing it. Access through a shared folder is shown — it stays until the folder is unshared.'
              : 'Pick people, then share folders or single profiles with them. A shared folder stays live — profiles added to it later reach them automatically.'}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-1 flex-col items-start gap-2 p-6">
            <p className="text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" onClick={() => load(true)}>
              Retry
            </Button>
          </div>
        ) : !data ? (
          <div className="flex min-h-0 flex-1" role="status" aria-label="Loading sharing">
            {!focus && (
              <div className="w-72 shrink-0 space-y-3 border-r border-white/[0.07] p-4">
                {['w-28', 'w-36', 'w-24', 'w-32', 'w-28'].map((w, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <Skeleton className="size-4 rounded-[4px]" />
                    <div className="space-y-1.5">
                      <Skeleton className={`h-4 ${w} rounded`} />
                      <Skeleton className="h-3 w-40 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-3 p-5">
              {['w-44', 'w-32', 'w-52', 'w-36', 'w-48'].map((w, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className={`h-4 ${w} rounded`} />
                  <Skeleton className="h-6 w-16 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        ) : members.length === 0 ? (
          <p className="max-w-[62ch] p-6 text-sm text-zinc-400">
            Nobody holds a GoLogin seat through Bluu yet. Add people under Members first — admins see
            every profile already and are not listed here.
          </p>
        ) : focus ? (
          // ── Profile first ────────────────────────────────────────────
          <div className="flex min-h-0 flex-1 flex-col">
            {!focused ? (
              <p className="p-6 text-sm text-zinc-400">
                That profile is not in the workspace listing any more — it may have been deleted.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
                {members.map((member) => {
                  const direct = member.profileIds.includes(focused.id);
                  const via = viaFor(member, focused.id);
                  const name = focused.name || 'this profile';
                  return (
                    <li key={member.uid} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-white">{member.displayName}</span>
                        <span className="block truncate text-[11px] text-zinc-400">
                          {!member.hasSeat ? (
                            <span className="text-red-400">Seat removed in GoLogin</span>
                          ) : direct && via.length ? (
                            `Shared directly, and via ${via.join(', ')}`
                          ) : direct ? (
                            'Shared directly'
                          ) : via.length ? (
                            `Can open it via ${via.join(', ')}`
                          ) : (
                            'No access'
                          )}
                        </span>
                      </span>
                      <Button
                        variant={direct ? 'ghost' : 'outline'}
                        size="xs"
                        className={`h-7 shrink-0 ${direct ? 'text-zinc-400 hover:text-red-400' : ''}`}
                        disabled={!member.hasSeat || !!busy}
                        aria-label={direct ? `Stop sharing ${name} with ${member.displayName}` : `Share ${name} with ${member.displayName}`}
                        title={
                          direct && via.length
                            ? `They keep access through ${via.join(', ')}.`
                            : undefined
                        }
                        onClick={() => void share('profiles', focused.id, direct ? 'remove' : 'add', name, [member])}
                      >
                        {isBusy('profiles', focused.id, member.uid) && <Loader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />}
                        {direct ? 'Stop sharing' : 'Share'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="shrink-0 border-t border-white/[0.07] px-6 py-3">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 text-zinc-400 hover:text-white"
                onClick={() => {
                  setQuery(focus.name);
                  setFocus(null);
                }}
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Share with several people, or whole folders
              </Button>
            </div>
          </div>
        ) : (
          // ── People first ─────────────────────────────────────────────
          <div className="flex min-h-0 flex-1">
            <div className="flex w-72 shrink-0 flex-col border-r border-white/[0.07]">
              <div className="shrink-0 space-y-2 border-b border-white/[0.07] p-3">
                {members.length > 8 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" aria-hidden />
                    <Input
                      value={peopleQuery}
                      onChange={(e) => setPeopleQuery(e.target.value)}
                      placeholder="Find a person"
                      aria-label="Find a person"
                      className={`h-8 pl-8 text-xs ${FIELD}`}
                    />
                  </div>
                )}
                <label className="flex cursor-pointer items-center gap-2.5 px-1 text-xs text-zinc-400">
                  <Checkbox
                    checked={allVisiblePicked}
                    onCheckedChange={(value) => {
                      setPicked((prev) => {
                        const next = new Set(prev);
                        for (const m of visibleMembers) {
                          if (value === true) next.add(m.uid);
                          else next.delete(m.uid);
                        }
                        return next;
                      });
                    }}
                    className={CHECKBOX_ON}
                  />
                  Select all{peopleQuery.trim() ? ' shown' : ''}
                </label>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                {visibleMembers.map((member) => {
                  const on = picked.has(member.uid);
                  return (
                    <li key={member.uid}>
                      <label
                        className={`flex cursor-pointer items-start gap-2.5 px-4 py-2 transition-colors ${
                          on ? 'bg-[#3b82f6]/15' : 'hover:bg-white/[0.055]'
                        }`}
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(value) => togglePerson(member.uid, value === true)}
                          className={`mt-0.5 ${CHECKBOX_ON}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm ${on ? 'font-semibold text-white' : 'font-medium text-zinc-300'}`}>
                            {member.displayName}
                          </span>
                          <span className="block truncate text-[11px] text-zinc-400">
                            {member.hasSeat ? (
                              <>
                                <span className="tabular-nums">{member.folderIds.length}</span> folders
                                <span aria-hidden> · </span>
                                <span className="tabular-nums">{member.profileIds.length}</span> profiles
                              </>
                            ) : (
                              <span className="text-red-400">Seat removed in GoLogin</span>
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
                {!visibleMembers.length && (
                  <li className="px-4 py-3 text-[11px] text-zinc-400">Nobody matches.</li>
                )}
              </ul>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {!selectedNames ? (
                // Said, not dimmed: an `opacity-50` pane read as broken, pushed
                // its grey text under the contrast floor, and disabled nothing a
                // screen reader could tell.
                <p className="p-6 text-sm text-zinc-400">
                  Pick one or more people on the left to see what they can open, and to share with them.
                </p>
              ) : (
                <>
                  <div className="shrink-0 border-b border-white/[0.07] px-5 py-3">
                    {/* Who every control below writes to, said outright — each
                        click hands out, or takes back, live accounts. */}
                    <p className="mb-2 truncate text-sm text-zinc-400">
                      Sharing with <span className="font-semibold text-white">{selectedNames}</span>
                    </p>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search folders and profiles"
                        aria-label="Search folders and profiles"
                        className={`pl-9 ${FIELD}`}
                      />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
                    {/* Folders first — "give Kai the JORGE accounts" is the
                        request that actually arrives. Hidden while searching, so a
                        bulk control never sits above a filtered list. */}
                    {!query.trim() && data.folders.length > 0 && (
                      <section className="mb-2 border-b border-white/[0.07] pb-2">
                        <h4 className="px-3 py-1.5 text-xs font-medium text-zinc-400">Folders</h4>
                        <ul>
                          {data.folders.map((folder) => {
                            const cov = {
                              n: selected.filter((m) => m.folderIds.includes(folder.id)).length,
                              of: selected.length,
                            };
                            const action: Action = isFull(cov) ? 'remove' : 'add';
                            return (
                              <li key={folder.id}>
                                <button
                                  type="button"
                                  disabled={!!busy}
                                  onClick={() => setConfirmFolder({ folder, action })}
                                  aria-label={`${action === 'add' ? 'Share' : 'Stop sharing'} the folder ${folder.name} with ${selectedNames} — ${coverageLabel(cov)}`}
                                  className={ROW}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm text-white">{folder.name}</span>
                                    <span className="block text-[11px] tabular-nums text-zinc-400">
                                      {plural(folder.profileIds.length, 'profile')}
                                    </span>
                                  </span>
                                  <CoveragePill cov={cov} action={action} busy={isBusy('folders', folder.id)} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )}

                    <h4 className="px-3 py-1.5 text-xs font-medium text-zinc-400">Profiles</h4>
                    {data.truncated && (
                      <p className="px-3 pb-1 text-[11px] text-zinc-400">
                        Showing the first {data.profiles.length} profiles in the workspace.
                      </p>
                    )}
                    {profiles.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-zinc-400">
                        {query.trim() ? (
                          <>
                            Nothing matches that search.{' '}
                            <button type="button" onClick={() => setQuery('')} className="underline underline-offset-2 hover:text-white">
                              Clear it
                            </button>
                          </>
                        ) : (
                          'There are no profiles in this workspace yet.'
                        )}
                      </p>
                    ) : (
                      <ul>
                        {profiles.map((profile: SharingProfile) => {
                          const cov = { n: reach.direct.get(profile.id) ?? 0, of: selected.length };
                          const action: Action = isFull(cov) ? 'remove' : 'add';
                          const via = [...(reach.via.get(profile.id) ?? [])];
                          const name = profile.name || 'this profile';
                          return (
                            <li key={profile.id}>
                              <button
                                type="button"
                                disabled={!!busy}
                                onClick={() => void share('profiles', profile.id, action, name, selected)}
                                // The verb is in the name: `aria-pressed` on a
                                // "2 of 3" row could not say that a click shares
                                // with all three.
                                aria-label={`${action === 'add' ? 'Share' : 'Stop sharing'} ${name} with ${selectedNames} — ${coverageLabel(cov)}`}
                                className={ROW}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm text-white">{profile.name || 'Untitled profile'}</span>
                                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
                                    <OsIcon os={profile.os} osSpec={profile.osSpec} />
                                    <span className="truncate">{profile.folders.join(' · ')}</span>
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                  {via.length > 0 && (
                                    <span
                                      className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300"
                                      title="Unsharing it individually does not remove access through this folder."
                                    >
                                      via {via.length === 1 ? via[0] : `${via.length} folders`}
                                    </span>
                                  )}
                                  <CoveragePill cov={cov} action={action} busy={isBusy('profiles', profile.id)} />
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={!!confirmFolder} onOpenChange={(next) => !next && setConfirmFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmFolder?.action === 'add'
                ? `Share ${confirmFolder?.folder.name} with ${selectedNames}?`
                : `Stop sharing ${confirmFolder?.folder.name} with ${selectedNames}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmFolder?.action === 'add' ? (
                <>
                  {plural(confirmFolder?.folder.profileIds.length ?? 0, 'live, signed-in profile')} become
                  openable by {plural(selected.length, 'person', 'people')}. The share is live: profiles
                  added to {confirmFolder?.folder.name} later reach them too.
                </>
              ) : (
                <>
                  They lose every profile they reach through {confirmFolder?.folder.name}. Profiles
                  shared with them individually are kept, and anything they have open stays open until
                  they close it.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmFolder?.action === 'remove' ? DANGER_BUTTON : PRIMARY_BUTTON}
              onClick={() => {
                if (!confirmFolder) return;
                const { folder, action } = confirmFolder;
                setConfirmFolder(null);
                void share('folders', folder.id, action, folder.name, selected);
              }}
            >
              {confirmFolder?.action === 'add' ? 'Share folder' : 'Stop sharing'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/**
 * The state of one item across the selected people, and on hover or focus the
 * verb a click performs. Filled Action Blue Deep only when *everyone* selected
 * has it — the one state worth the accent; a partial share is a neutral count,
 * and "not shared" is the quiet default.
 */
function CoveragePill({ cov, action, busy }: { cov: Coverage; action: Action; busy: boolean }) {
  if (busy) return <Loader2 className="activity-spinner size-4 shrink-0 animate-spin text-blue-400" aria-hidden />;
  const all = isFull(cov);
  return (
    <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
      {/* Revealed with the row's hover and focus (DESIGN.md §5), so the pill
          says what *is* and this says what a click *does*. */}
      <span className="text-[11px] text-zinc-400 opacity-0 transition-opacity [button:hover_&]:opacity-100 [button:focus-visible_&]:opacity-100">
        {action === 'add' ? 'Share' : 'Stop sharing'}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
          all ? 'bg-[#2563eb] text-white' : cov.n > 0 ? 'bg-white/[0.08] text-zinc-300' : 'bg-white/[0.04] text-zinc-400'
        }`}
      >
        {coverageLabel(cov)}
      </span>
    </span>
  );
}
